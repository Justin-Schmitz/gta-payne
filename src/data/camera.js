/**
 * Third-person camera presets (cycle with V / the CAM button). `tilt` is an extra downward pitch
 * on the camera (the crosshair follows it, so aiming stays consistent), `driveZoom` scales the
 * top-down height while driving.
 */
export const CAMERA_PRESETS = {
  close: { id: 'close', label: 'CLOSE', dist: 4.0, shoulder: 0.75, pivotY: 1.55, tilt: 0.0, fov: 55, driveZoom: 0.85 },
  medium: { id: 'medium', label: 'MEDIUM', dist: 6.5, shoulder: 0.6, pivotY: 2.1, tilt: 0.14, fov: 60, driveZoom: 1.0 },
  far: { id: 'far', label: 'HIGH & WIDE', dist: 9.5, shoulder: 0.4, pivotY: 2.9, tilt: 0.26, fov: 64, driveZoom: 1.35 },
};
export const CAMERA_ORDER = ['close', 'medium', 'far'];
export const getCameraPreset = (id) => CAMERA_PRESETS[id] || CAMERA_PRESETS.medium;
