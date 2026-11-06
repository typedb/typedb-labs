"""Minimal reproduction: TypeDB 3.14.1 query planner fails (QPL1) on an `is` disjunction.

Run against a TypeDB 3.14.1 server (creates and deletes its own database):
    docker exec -i noodlelab-api python - < docs/typedb-issues/qpl1_repro.py
or anywhere with typedb-driver 3.14.0:  TYPEDB_ADDRESS=127.0.0.1:1729 python qpl1_repro.py
"""

import os

from typedb.driver import Credentials, DriverOptions, DriverTlsConfig, TransactionType, TypeDB

ADDRESS = os.environ.get("TYPEDB_ADDRESS", "typedb:1729")
DB = "qpl1-repro"

SCHEMA = """
define
  attribute code, value string;
  entity group, owns code @key, plays membership:parent, plays membership:member;
  relation membership, relates parent, relates member;
"""
DATA = """
insert
  $a isa group, has code "a";
  $b isa group, has code "b";
  membership (parent: $a, member: $b);
"""
QUERIES = {
    "FAILS: is-branch or relation-branch": """
        match $s isa group, has code "a";
          { $x is $s; } or { membership (parent: $s, member: $x); };
        fetch { "x": $x.code };""",
    "FAILS: same, with the type of $x restated in the branch": """
        match $s isa group, has code "a";
          { $x is $s; } or { membership (parent: $s, member: $x); $x isa group; };
        fetch { "x": $x.code };""",
    "WORKS: alternative, downstream pattern repeated per branch": """
        match $s isa group, has code "a";
          { $s has code $c; } or { membership (parent: $s, member: $x); $x has code $c; };
        fetch { "x": $c };""",
}

driver = TypeDB.driver(ADDRESS, Credentials("admin", "password"), DriverOptions(DriverTlsConfig.disabled()))
if driver.databases.contains(DB):
    driver.databases.get(DB).delete()
driver.databases.create(DB)
try:
    for kind, text in ((TransactionType.SCHEMA, SCHEMA), (TransactionType.WRITE, DATA)):
        with driver.transaction(DB, kind) as tx:
            tx.query(text).resolve()
            tx.commit()
    for label, query in QUERIES.items():
        with driver.transaction(DB, TransactionType.READ) as tx:
            try:
                rows = list(tx.query(query).resolve().as_concept_documents())
                print(f"{label}\n  -> OK {sorted(r['x'] for r in rows)}")
            except Exception as error:
                print(f"{label}\n  -> ERROR {str(error).strip().splitlines()[0]}")
                for line in str(error).strip().splitlines()[1:]:
                    print(f"           {line}")
finally:
    driver.databases.get(DB).delete()
