import HabitatMode from './features/habitat-mode/HabitatMode';

/**
 * Application root.
 *
 * Habitat Mode is the first operating environment. Field Tablet Mode will be
 * added as a second layout over the same mission model and data catalog in a
 * later milestone (Architecture.md §3, Context.md §4.3).
 */
export default function App() {
  return <HabitatMode />;
}
