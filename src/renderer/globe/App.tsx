import { useState, useEffect, useCallback, useRef, memo } from 'react'
import * as Cesium from 'cesium'
import Globe from './Globe'
import SatelliteOverlay from './SatelliteOverlay'
import LayerPanel from './LayerPanel'
import Hud from './Hud'
import CockpitShell from './CockpitShell'
import DrawTools from './DrawTools'
import PluginPanel from './plugins/PluginPanel'
import InspectorPanel from './InspectorPanel'
import StatusBar from './StatusBar'
import { pluginManager } from './plugins'
import type { PluginContext } from './plugins'
import type { GIBSLayer, DrawMode, Selection, LngLat } from '@shared/types'
import { selectionToBBox } from '@shared/types'

// ── Earth Engine v0.3 — cockpit windowing + plugin architecture ──

const MemoGlobe = memo(Globe)
const MemoLayerPanel = memo(LayerPanel)
const MemoHud = memo(Hud)
const MemoPluginPanel = memo(PluginPanel)
const MemoInspectorPanel = memo(InspectorPanel)
const MemoStatusBar = memo(StatusBar)

export default function App() {
  // ── Globe Renderer state ──
  const [viewer, setViewer] = useState<Cesium.Viewer | null>(null)
  const [gibsLayers, setGibsLayers] = useState<GIBSLayer[]>([])
  const [imageryLayer, setImageryLayer] = useState<string>('esri')
  const [imageryOpacity, setImageryOpacity] = useState<number>(1.0)
  const [terrain3d, setTerrain3d] = useState<boolean>(false)
  const [hillshade, setHillshade] = useState<boolean>(false)
  const [terrainExaggeration, setTerrainExaggeration] = useState<number>(2.0)
  const [roadsVisible, setRoadsVisible] = useState<boolean>(true)
  const [labelsVisible, setLabelsVisible] = useState<boolean>(true)

  // ── Scene Context ──
  const viewportRef = useRef<unknown>(null)
  const [hudViewport, setHudViewport] = useState<unknown>(null)

  // ── Live Feed ──
  const [satellitesVisible, setSatellitesVisible] = useState<boolean>(true)

  // ── Drawing / Selection ──
  const [drawMode, setDrawMode] = useState<DrawMode>('none')
  const [selection, setSelection] = useState<Selection | null>(null)
  const [lkpPin, setLkpPin] = useState<LngLat | null>(null)

  // ── Plugin state ──
  const [activePlugins, setActivePlugins] = useState<Set<string>>(new Set())
  const pluginCtxRef = useRef<PluginContext | null>(null)

  // ── Cockpit windowing state ──
  const [dockConfig, setDockConfig] = useState({
    leftWidth: 260,
    rightWidth: 280,
    leftVisible: true,
    rightVisible: true,
    activeLeftTab: 'plugins' as 'layers' | 'plugins',
  })

  useEffect(() => {
    window.api.imagery.layers().then((layers) => setGibsLayers(layers as GIBSLayer[]))
  }, [])

  // Camera move — store in ref, send to Scene Context, throttle HUD, update plugins
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pluginUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCameraMove = useCallback((vp: unknown) => {
    viewportRef.current = vp
    window.api.scene.sendViewport(vp)

    if (hudTimerRef.current) return
    hudTimerRef.current = setTimeout(() => {
      hudTimerRef.current = null
      setHudViewport(viewportRef.current)
    }, 500)

    if (pluginUpdateTimer.current) return
    pluginUpdateTimer.current = setTimeout(() => {
      pluginUpdateTimer.current = null
      if (pluginCtxRef.current) {
        // Merge user-drawn selection bbox into scene context for plugins
        const selBbox = selection ? selectionToBBox(selection) : null
        const vp = viewportRef.current as Record<string, unknown> | null
        pluginManager.updateAll({
          ...pluginCtxRef.current,
          sceneContext: {
            ...(vp ?? {}),
            selection,
            selectionBbox: selBbox,
            lkp: lkpPin,
          },
        })
      }
    }, 1000)
  }, [selection, lkpPin])

  // Apply opacity to base imagery
  useEffect(() => {
    if (!viewer) return
    const layer = viewer.imageryLayers.get(0)
    if (layer) layer.alpha = imageryOpacity
  }, [viewer, imageryOpacity])

  // ── Plugin lifecycle ──
  const togglePlugin = useCallback((id: string) => {
    if (activePlugins.has(id)) {
      pluginManager.deactivate(id)
      setActivePlugins((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    } else {
      if (pluginCtxRef.current) {
        pluginManager.activate(id)
        setActivePlugins((prev) => new Set(prev).add(id))
        // Immediately send current scene context to the newly-activated plugin
        // so it can process the current selection without waiting for a change
        const selBbox = selection ? selectionToBBox(selection) : null
        const vp = viewportRef.current as Record<string, unknown> | null
        pluginManager.updateAll({
          ...pluginCtxRef.current,
          sceneContext: {
            ...(vp ?? {}),
            selection,
            selectionBbox: selBbox,
            lkp: lkpPin,
          },
        })
      }
    }
  }, [activePlugins, selection, lkpPin])

  // Set up plugin context when viewer is ready
  useEffect(() => {
    if (!viewer) return
    const selBbox = selection ? selectionToBBox(selection) : null
    const vp = viewportRef.current as Record<string, unknown> | null
    const ctx: PluginContext = {
      viewer,
      sceneContext: {
        ...(vp ?? {}),
        selection,
        selectionBbox: selBbox,
        lkp: lkpPin,
      },
      ipc: window.api,
    }
    pluginCtxRef.current = ctx
    pluginManager.setContext(ctx)
  }, [viewer, selection, lkpPin])

  // Shutdown plugins on unmount
  useEffect(() => {
    return () => pluginManager.shutdown()
  }, [])

  const allPlugins = pluginManager.getPlugins()

  return (
    <CockpitShell
      config={dockConfig}
      onConfigChange={setDockConfig}
      leftLayers={
        <MemoLayerPanel
          gibsLayers={gibsLayers}
          imageryLayer={imageryLayer}
          onImageryLayerChange={setImageryLayer}
          overlayVisible={{}}
          onOverlayToggle={() => {}}
          imageryOpacity={imageryOpacity}
          onImageryOpacityChange={setImageryOpacity}
          liveVisible={{ satellites: satellitesVisible }}
          onLiveToggle={(key: string) => {
            if (key === 'satellites') setSatellitesVisible(!satellitesVisible)
          }}
          terrain3d={terrain3d}
          onTerrain3dToggle={() => setTerrain3d(!terrain3d)}
          hillshade={hillshade}
          onHillshadeToggle={() => setHillshade(!hillshade)}
          terrainExaggeration={terrainExaggeration}
          onTerrainExaggerationChange={setTerrainExaggeration}
          roadsVisible={roadsVisible}
          onRoadsToggle={() => setRoadsVisible(!roadsVisible)}
          labelsVisible={labelsVisible}
          onLabelsToggle={() => setLabelsVisible(!labelsVisible)}
        />
      }
      leftPlugins={
        <MemoPluginPanel
          plugins={allPlugins}
          activePlugins={activePlugins}
          onToggle={togglePlugin}
        />
      }
      rightPanel={
        <MemoInspectorPanel
          plugins={allPlugins}
          activePlugins={activePlugins}
          selection={selection}
          lkp={lkpPin}
        />
      }
      statusBar={
        <MemoStatusBar
          plugins={allPlugins}
          activePlugins={activePlugins}
          viewport={hudViewport}
          hillshade={hillshade}
          viewer={viewer}
        />
      }
    >
      <MemoGlobe
        imageryLayer={imageryLayer}
        gibsLayers={gibsLayers}
        imageryOpacity={imageryOpacity}
        terrain3d={terrain3d}
        hillshade={hillshade}
        terrainExaggeration={terrainExaggeration}
        roadsVisible={roadsVisible}
        labelsVisible={labelsVisible}
        onViewerReady={setViewer}
        onCameraMove={onCameraMove}
        drawMode={drawMode}
        onSelectionChange={setSelection}
        onPinPlace={setLkpPin}
        selection={selection}
        lkpPin={lkpPin}
      />

      {/* Drawing toolbar */}
      <DrawTools
        mode={drawMode}
        onModeChange={setDrawMode}
        onClear={() => {
          setSelection(null)
          setLkpPin(null)
        }}
        hasSelection={selection !== null || lkpPin !== null}
      />

      {/* Satellites overlay */}
      {viewer && satellitesVisible && <SatelliteOverlay viewer={viewer} />}

      {/* HUD bar */}
      <MemoHud viewport={hudViewport} imageryLayer={imageryLayer} />
    </CockpitShell>
  )
}
