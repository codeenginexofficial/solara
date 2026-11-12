/**
 * HabitatMode — desktop mission-planning workspace (Context.md §4.1).
 *
 * Layout (Design.md §5): top bar / [left panel | map | right panel] / status
 * bar. The map is the primary workspace. All map state flows through plain
 * serializable values; OpenLayers objects stay inside MarsMap.
 */

import { useCallback, useRef, useState } from 'react';
import type { MarsMapHandle } from '../../map/MarsMap';
import MarsMap from '../../map/MarsMap';
import type { MapLocation, SourceStatus, ViewInfo } from '../../map/mapTypes';
import { getAllDatasets, getAllRegions, getDatasetById } from '../../data/catalog/datasets';
import type { LayerUiState } from './components/LayerPanel';
import { TopBar } from './components/TopBar';
import { LayerPanel } from './components/LayerPanel';
import { DatasetPanel } from './components/DatasetPanel';
import { LocationPanel } from './components/LocationPanel';
import { StatusBar } from './components/StatusBar';
import { cn } from '../../lib/utils';

const DATASETS = getAllDatasets();
const REGIONS = getAllRegions();
const REGION = REGIONS[0]!;
const INITIAL_DATASET_ID = REGION.datasetIds[0] ?? '';

export default function HabitatMode() {
  const mapApi = useRef<MarsMapHandle | null>(null);

  const [layerStates, setLayerStates] = useState<Record<string, LayerUiState>>(() =>
    Object.fromEntries(
      DATASETS.filter((d) => d.verification === 'integrated').map((d) => [
        d.id,
        { visible: true, opacity: 1 },
      ]),
    ),
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(INITIAL_DATASET_ID);
  const [pointerLocation, setPointerLocation] = useState<MapLocation | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<MapLocation | null>(null);
  const [viewInfo, setViewInfo] = useState<ViewInfo | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>({
    capabilities: 'checking',
    lastCheckedAt: null,
    message: 'Checking source…',
  });
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);

  const selectedDataset = getDatasetById(selectedDatasetId);

  const handleToggleVisibility = useCallback((id: string, visible: boolean) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { opacity: 1 }), visible } }));
  }, []);

  const handleOpacityChange = useCallback((id: string, opacity: number) => {
    setLayerStates((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { visible: true }), opacity } }));
  }, []);

  const handleFitRegion = useCallback(() => {
    mapApi.current?.fitToDataset();
  }, []);

  const datasetForMap =
    selectedDataset && selectedDataset.verification === 'integrated'
      ? selectedDataset
      : DATASETS.find((d) => d.verification === 'integrated') ?? DATASETS[0]!;

  const layerState: LayerUiState =
    layerStates[datasetForMap.id] ?? { visible: true, opacity: 1 };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <TopBar
        regionLabel={REGION.name}
        sourceStatus={sourceStatus}
        onFitRegion={handleFitRegion}
        onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
        onToggleRightPanel={() => setRightPanelOpen((v) => !v)}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* Left panel — layer controls, sources, region info */}
        <aside
          className={cn(
            'absolute inset-y-0 left-0 z-20 w-72 flex-col border-r border-edge bg-panel shadow-2xl lg:static lg:z-auto lg:flex lg:shadow-none',
            leftPanelOpen ? 'flex' : 'hidden lg:flex',
          )}
          aria-label="Layers and region"
        >
          <LayerPanel
            datasets={DATASETS}
            region={REGION}
            layerStates={layerStates}
            selectedDatasetId={selectedDatasetId}
            onSelectDataset={setSelectedDatasetId}
            onToggleVisibility={handleToggleVisibility}
            onOpacityChange={handleOpacityChange}
          />
        </aside>

        {/* Main map workspace */}
        <main className="relative min-w-0 flex-1">
          <MarsMap
            ref={mapApi}
            dataset={datasetForMap}
            layerState={layerState}
            onPointerLocationChange={setPointerLocation}
            onLocationSelect={setSelectedLocation}
            onViewChange={setViewInfo}
            onSourceStatusChange={setSourceStatus}
          />
        </main>

        {/* Right panel — dataset provenance and selected location */}
        <aside
          className={cn(
            'absolute inset-y-0 right-0 z-20 w-80 flex-col overflow-y-auto border-l border-edge bg-panel shadow-2xl lg:static lg:z-auto lg:flex lg:shadow-none',
            rightPanelOpen ? 'flex' : 'hidden lg:flex',
          )}
          aria-label="Dataset details and selected location"
        >
          {selectedDataset && <DatasetPanel dataset={selectedDataset} />}
          <LocationPanel location={selectedLocation} />
        </aside>
      </div>

      <StatusBar
        pointerLocation={pointerLocation}
        viewInfo={viewInfo}
        dataset={datasetForMap}
        sourceStatus={sourceStatus}
      />
    </div>
  );
}
