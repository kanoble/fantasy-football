"""Free public data sources. None of these require authentication.

Each module is independently testable and has no dependency on the Yahoo layer,
so the whole analytics layer can be developed while Yahoo API access is still
pending approval.

All four are non-commercial-use sources. See README.md for attribution.

Three feed the daily refresh (nflverse, sleeper, rotowire). The fourth, ffc,
is a one-time historical backfill run by hand — see its module docstring.
"""
