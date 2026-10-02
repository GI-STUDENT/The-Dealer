import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

files = sorted(DOCS.glob("*.md"))
problems = []

def strip_noise(sql):
    # remove dollar-quoted bodies and single-quoted strings so parens inside them do not count
    out, i, n = [], 0, len(sql)
    while i < n:
        if sql.startswith("$$", i):
            j = sql.find("$$", i + 2)
            j = n if j == -1 else j + 2
            out.append(" " * (j - i)); i = j
        elif sql[i] == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql[j+1:j+2] == "'":
                    j += 2; continue
                if sql[j] == "'":
                    j += 1; break
                j += 1
            out.append("''"); i = j
        elif sql.startswith("--", i):
            j = sql.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i)); i = j
        else:
            out.append(sql[i]); i += 1
    return "".join(out)

sql_blocks = []
for f in files:
    text = f.read_text(encoding="utf-8")
    lines = text.split("\n")
    inblk, buf, start = False, [], 0
    for idx, ln in enumerate(lines, 1):
        if not inblk and ln.strip().startswith("```sql"):
            inblk, buf, start = True, [], idx + 1
            continue
        if inblk and ln.strip() == "```":
            sql_blocks.append((f.name, start, "\n".join(buf)))
            inblk = False
            continue
        if inblk:
            buf.append(ln)

print(f"SQL blocks found: {len(sql_blocks)}\n")

for fname, line, sql in sql_blocks:
    clean = strip_noise(sql)
    for ch_open, ch_close in (("(", ")"), ("(", ")")):
        pass
    for op, cl, label in (("(", ")", "paren"), ("[", "]", "bracket")):
        d = 0
        bad = False
        for k, ch in enumerate(clean):
            if ch == op: d += 1
            elif ch == cl:
                d -= 1
                if d < 0:
                    nl = sql.count("\n", 0, k) + 1
                    problems.append(f"{fname}:{line+nl}  unbalanced '{cl}' (extra close)")
                    bad = True; break
        if not bad and d != 0:
            problems.append(f"{fname}:{line}  unbalanced '{op}': depth {d} at end of block")
    # each CREATE TABLE must be closed
    for m in re.finditer(r"CREATE TABLE (\w+)", sql):
        pass

# tables defined vs referenced, across 04-data-model.md
dm = (DOCS / "04-data-model.md").read_text(encoding="utf-8")
defined = set(re.findall(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+)", dm))
enums = set(re.findall(r"CREATE TYPE (\w+)", dm))
types_used = set(re.findall(r"REFERENCES (\w+)\(", dm))
missing = sorted(t for t in types_used if t not in defined)
if missing:
    problems.append("04-data-model.md: REFERENCES to undefined tables: " + ", ".join(missing))

# columns defined per table, to catch stale column refs in CHECK constraints
cols = {}
for m in re.finditer(r"CREATE TABLE (\w+) \((.*?)\n\);", dm, re.S):
    tbl, body = m.group(1), m.group(2)
    cols[tbl] = set(re.findall(r"^\s{2}(\w+)\s", body, re.M))

for tbl, defined_cols in cols.items():
    if tbl != "transactions":
        continue
    body = re.search(r"CREATE TABLE transactions \((.*?)\n\);", dm, re.S).group(1)
    refd = set(re.findall(r"\b(\w+_minor)\b", body))
    unknown = sorted(c for c in refd if c not in defined_cols)
    if unknown:
        problems.append(f"transactions: constraint references unknown column(s): {unknown}")

# enum values referenced in the doc but not declared
declared_enum_vals = set(re.findall(r"CREATE TYPE (\w+)\s+AS ENUM \((.*?)\);", dm, re.S))
vals_by_enum = {}
for name, body in declared_enum_vals:
    vals_by_enum[name] = set(re.findall(r"'([^']+)'", body))
allvals = set().union(*vals_by_enum.values())

if problems:
    print("PROBLEMS")
    for p in problems:
        print("  -", p)
else:
    print("No structural problems found.")

print(f"\nTables defined: {len(defined)}   Enums defined: {len(enums)}")

# ---- creation-order check: PostgreSQL cannot execute a REFERENCES to a not-yet-created table ----
order = [m.group(1) for m in re.finditer(r"CREATE TABLE (?:IF NOT EXISTS )?(\w+)", dm)]
pos = {t: i for i, t in enumerate(order)}

print("\n--- table creation order ---")
forward = []
for t in order:
    m = re.search(rf"CREATE TABLE (?:IF NOT EXISTS )?{t} \((.*?)\n\);", dm, re.S)
    if not m:
        continue
    body = m.group(1)
    for ref in sorted(set(re.findall(r"REFERENCES (\w+)\(", body))):
        if ref in pos and pos[ref] > pos[t]:
            forward.append((t, ref, pos[ref] - pos[t]))
        elif ref not in pos:
            forward.append((t, ref, -1))

if forward:
    print(f"FORWARD REFERENCES (would fail on a clean database): {len(forward)}")
    for t, ref, gap in sorted(forward, key=lambda x: -x[2]):
        kind = "NEVER DEFINED" if gap < 0 else f"{gap} tables later"
        print(f"  {t:<32} -> {ref:<28} ({kind})")
else:
    print("No forward references.")

# ---- PostgreSQL rejects conditional UNIQUE table constraints; only partial indexes work ----
print("\n--- invalid conditional UNIQUE constraints ---")
bad_uq = []
for m in re.finditer(r"CONSTRAINT\s+\w+\s+UNIQUE\s*\(([^)]*)\)([^;]*);", dm, re.S):
    if "WHERE" in m.group(2).upper():
        bad_uq.append((dm.count("\n", 0, m.start()) + 1,
                       " ".join(m.group(2).split())[:70]))
if bad_uq:
    for ln, txt in bad_uq:
        print(f"  L{ln}: CONSTRAINT UNIQUE ... {txt}   <-- not valid PostgreSQL")
else:
    print("None. (Conditional uniqueness must use CREATE UNIQUE INDEX ... WHERE.)")

# ---- validate the deferred FK block in section 13.5 ----
print("\n--- deferred foreign keys (section 13.5) ---")
deferred = re.findall(
    r"ALTER TABLE (\w+)\s+ADD CONSTRAINT \w+\s+FOREIGN KEY \((\w+)\)\s+REFERENCES (\w+)\((\w+)\)", dm)
if not deferred:
    print("No deferred FKs found.")
else:
    for tbl, col, reftbl, refcol in deferred:
        prob = []
        if tbl not in defined:   prob.append(f"table {tbl} not defined")
        if reftbl not in defined: prob.append(f"references undefined table {reftbl}")
        if prob:
            print(f"  BAD  {tbl}.{col} -> {reftbl}.{refcol}: {'; '.join(prob)}")
        elif col not in cols.get(tbl, ()):
            print(f"  BAD  {tbl} has no column {col}")
        else:
            print(f"  ok   {tbl}.{col} -> {reftbl}.{refcol}")
    covered = {(t, c) for t, c, _, _ in deferred}
    missing_cov = sorted(
        (t, r) for t, r, g in forward if g >= 0
        and (t, next((c for c in cols.get(t, ()) if c.endswith('_id') and c.rstrip('_id') in r), '')) not in covered
    )
    if missing_cov:
        print("  NOTE: forward refs with no matching deferred FK:")
        for t, r in missing_cov:
            print(f"        {t} -> {r}")

