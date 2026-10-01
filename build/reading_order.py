"""
Pure reading-order grouping algorithm (Change Request 3, Change 2): given a
lesson's objects as (lon, lat) reference points, number them the way you'd
read a page - rows north to south, west to east within each row.

No I/O, no geometry resolution - just the grouping/sorting logic, so it can
be unit-tested directly on synthetic points (see test_reading_order.py) and
reused by build/number_lesson_objects.py on real reference points.
"""
import math


def reading_order(points):
    """points: list of (lon, lat). Returns a list of 1-based numbers, same
    length and index order as the input (numbers[i] is points[i]'s rank)."""
    n = len(points)
    if n == 0:
        return []
    if n == 1:
        return [1]

    lats = [p[1] for p in points]
    height = max(lats) - min(lats)
    bands = math.ceil(math.sqrt(n))
    band_h = height / bands if bands > 0 else 0

    # northernmost (highest latitude) first
    order = sorted(range(n), key=lambda i: -points[i][1])

    rows = []
    current_row = []
    row_start_lat = None
    for i in order:
        lat = points[i][1]
        if row_start_lat is None:
            row_start_lat = lat
            current_row = [i]
        elif band_h > 0 and (row_start_lat - lat) > band_h:
            rows.append(current_row)
            current_row = [i]
            row_start_lat = lat
        else:
            current_row.append(i)
    if current_row:
        rows.append(current_row)

    numbers = [0] * n
    num = 1
    for row in rows:
        row_sorted = sorted(row, key=lambda i: points[i][0])  # west -> east
        for i in row_sorted:
            numbers[i] = num
            num += 1
    return numbers
