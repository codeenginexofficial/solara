import { useState } from 'react';
import HabitatMode from './features/habitat-mode/HabitatMode';
import FieldTabletMode from './features/field-tablet/FieldTabletMode';

/**
 * Application root.
 *
 * Habitat Mode (desktop) and Field Tablet Mode (touch-first) are two
 * interfaces over the same mission model, data catalog, and map engine
 * (Context.md §4.4). The mode switch is deliberate — viewport width alone
 * never decides the operating mode (Design.md §6). It lives in each mode's
 * header; there is no floating control over the map.
 */
export default function App() {
  const [mode, setMode] = useState<'habitat' | 'tablet'>('habitat');

  return mode === 'habitat' ? (
    <HabitatMode onSwitchToTablet={() => setMode('tablet')} />
  ) : (
    <FieldTabletMode onExit={() => setMode('habitat')} />
  );
}
