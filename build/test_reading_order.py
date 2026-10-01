#!/usr/bin/env python3
"""
Unit test for build/reading_order.py (Change Request 3, Change 2): a
synthetic 3x3 grid, plus the same grid with one row's latitudes jittered,
asserting the exact expected reading order (rows north->south, west->east
within a row). Run directly:

    python3 build/test_reading_order.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reading_order import reading_order


def test_clean_3x3_grid():
    # lon in {0,1,2}, lat in {0,1,2} (lat 2 = north). Row-major order:
    # (lon,lat) -> expected number
    points = [
        (0, 2), (1, 2), (2, 2),  # north row -> 1, 2, 3
        (0, 1), (1, 1), (2, 1),  # middle row -> 4, 5, 6
        (0, 0), (1, 0), (2, 0),  # south row -> 7, 8, 9
    ]
    got = reading_order(points)
    expected = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert got == expected, f"clean grid: expected {expected}, got {got}"
    print("PASS: clean 3x3 grid ->", got)


def test_shuffled_input_order():
    # Same 9 points, fed in a scrambled input order - the returned numbers
    # must still track each point by its own position, not input order.
    points = [
        (2, 0), (0, 2), (1, 1), (2, 2), (0, 0),
        (1, 2), (2, 1), (0, 1), (1, 0),
    ]
    got = reading_order(points)
    expected_by_point = {
        (0, 2): 1, (1, 2): 2, (2, 2): 3,
        (0, 1): 4, (1, 1): 5, (2, 1): 6,
        (0, 0): 7, (1, 0): 8, (2, 0): 9,
    }
    for pt, num in zip(points, got):
        assert num == expected_by_point[pt], f"point {pt}: expected {expected_by_point[pt]}, got {num}"
    print("PASS: shuffled input order ->", got)


def test_jittered_row():
    # Middle row's latitudes jittered (1.05 / 0.95 / 1.0) - well under the
    # row-band height - must still land in one row, ordered by longitude.
    points = [
        (0, 2), (1, 2), (2, 2),      # north row, unjittered -> 1, 2, 3
        (0, 1.05), (1, 0.95), (2, 1.0),  # jittered middle row -> 4, 5, 6
        (0, 0), (1, 0), (2, 0),      # south row, unjittered -> 7, 8, 9
    ]
    got = reading_order(points)
    expected = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    assert got == expected, f"jittered row: expected {expected}, got {got}"
    print("PASS: jittered middle row ->", got)


def test_single_object():
    assert reading_order([(5, 5)]) == [1]
    print("PASS: single object")


def test_empty():
    assert reading_order([]) == []
    print("PASS: empty list")


if __name__ == "__main__":
    test_clean_3x3_grid()
    test_shuffled_input_order()
    test_jittered_row()
    test_single_object()
    test_empty()
    print("\nAll reading_order tests passed.")
