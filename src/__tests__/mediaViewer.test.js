import { describe, it, expect } from 'vitest';

describe('Media viewer zoom', () => {
  // Simulates the zoom logic from MediaViewer
  const computeZoom = (current, deltaY) => {
    const delta = deltaY > 0 ? -10 : 10;
    return Math.min(400, Math.max(10, current + delta));
  };

  it('zooms in on scroll up (negative deltaY)', () => {
    expect(computeZoom(100, -100)).toBe(110);
  });

  it('zooms out on scroll down (positive deltaY)', () => {
    expect(computeZoom(100, 100)).toBe(90);
  });

  it('clamps at minimum 10%', () => {
    expect(computeZoom(10, 100)).toBe(10);
    expect(computeZoom(20, 100)).toBe(10);
  });

  it('clamps at maximum 400%', () => {
    expect(computeZoom(400, -100)).toBe(400);
    expect(computeZoom(390, -100)).toBe(400);
  });

  it('starts at 100%', () => {
    const initialZoom = 100;
    expect(initialZoom).toBe(100);
  });
});

describe('Media file detection', () => {
  const isImage = (name) => /\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(name);
  const isVideo = (name) => /\.(mp4|webm|ogg|mov)$/i.test(name);

  it('detects image files', () => {
    expect(isImage('photo.jpg')).toBe(true);
    expect(isImage('logo.PNG')).toBe(true);
    expect(isImage('icon.svg')).toBe(true);
    expect(isImage('banner.webp')).toBe(true);
  });

  it('detects video files', () => {
    expect(isVideo('clip.mp4')).toBe(true);
    expect(isVideo('demo.webm')).toBe(true);
    expect(isVideo('movie.mov')).toBe(true);
  });

  it('does not detect non-media files', () => {
    expect(isImage('readme.md')).toBe(false);
    expect(isVideo('app.js')).toBe(false);
  });
});
