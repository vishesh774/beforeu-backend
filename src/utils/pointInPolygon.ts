/**
 * Point-in-Polygon algorithm using Ray Casting method
 * Determines if a point (lat, lng) is inside a polygon
 */

export interface Point {
  lat: number;
  lng: number;
}

/**
 * Check if a point is inside a polygon
 * @param point - The point to check (lat, lng)
 * @param polygon - Array of polygon vertices (must be closed, i.e., first point = last point)
 * @returns true if point is inside polygon, false otherwise
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (!polygon || polygon.length < 3) {
    return false;
  }

  const { lat, lng } = point;
  let inside = false;

  // Ray casting algorithm
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    const intersect = ((yi > lat) !== (yj > lat)) && 
                      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    
    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if multiple points are inside a polygon
 * @param points - Array of points to check
 * @param polygon - Array of polygon vertices
 * @returns Array of boolean values indicating if each point is inside
 */
export function arePointsInPolygon(points: Point[], polygon: Point[]): boolean[] {
  return points.map(point => isPointInPolygon(point, polygon));
}

