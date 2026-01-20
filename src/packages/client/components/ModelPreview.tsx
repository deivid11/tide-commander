import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AgentClass, AgentStatus } from '../../shared/types';
import { AGENT_CLASS_MODELS } from '../scene/config';

// Animation mapping for each status
const STATUS_ANIMATIONS: Record<AgentStatus, string> = {
  idle: 'idle',
  working: 'walk',      // Active, doing work
  waiting: 'sit',       // Waiting for input/response
  waiting_permission: 'idle', // Waiting for permission approval
  error: 'emote-no',    // Something went wrong
  offline: 'static',    // Not connected
  orphaned: 'idle',     // Out-of-sync process
};

// Color mapping for status indicator
const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x4aff9e,     // Green - ready
  working: 0x4a9eff,  // Blue - active
  waiting: 0xff9e4a,  // Orange - waiting
  waiting_permission: 0xffcc00, // Yellow/gold - awaiting permission
  error: 0xff4a4a,    // Red - error
  offline: 0x888888,  // Gray - offline
  orphaned: 0xff9e4a, // Orange - orphaned process
};

interface ModelPreviewProps {
  agentClass?: AgentClass;
  modelFile?: string;  // Direct model file (e.g., 'character-male-a.glb')
  status?: AgentStatus;
  width?: number;
  height?: number;
}

export function ModelPreview({ agentClass, modelFile, status = 'idle', width = 150, height = 200 }: ModelPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Object3D | null>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const animationsRef = useRef<Map<string, THREE.AnimationClip>>(new Map());
  const currentActionRef = useRef<THREE.AnimationAction | null>(null);
  const statusRingRef = useRef<THREE.Mesh | null>(null);
  const animationIdRef = useRef<number>(0);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const [isReady, setIsReady] = useState(false);

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a24);
    sceneRef.current = scene;

    // Create camera - zoomed in and centered on character (higher angle looking down)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.2, 1.4);
    camera.lookAt(0, 0.4, 0);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a1a24, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(2, 3, 2);
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0x4a9eff, 0.6);
    fillLight.position.set(-2, 1, -1);
    scene.add(fillLight);

    // Ground plane
    const groundGeo = new THREE.CircleGeometry(1, 32);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a,
      roughness: 0.8,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    scene.add(ground);

    // Status indicator ring
    const ringGeo = new THREE.RingGeometry(0.35, 0.42, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: STATUS_COLORS.idle,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
    statusRingRef.current = ring;

    setIsReady(true);

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      // Rotate model slowly
      if (modelRef.current) {
        modelRef.current.rotation.y += 0.01;
      }

      // Update animations
      if (mixerRef.current) {
        mixerRef.current.update(clockRef.current.getDelta());
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationIdRef.current);
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current = null;
      }
      sceneRef.current = null;
      cameraRef.current = null;
      modelRef.current = null;
      mixerRef.current = null;
      setIsReady(false);
    };
  }, [width, height]);

  // Load model when agentClass/modelFile changes or when ready
  useEffect(() => {
    if (!isReady || !sceneRef.current) return;

    const scene = sceneRef.current;
    // Use direct modelFile if provided, otherwise look up from agent class
    // Fallback to default model if agent class isn't in the map (e.g., custom classes)
    const resolvedModelFile = modelFile || (agentClass ? AGENT_CLASS_MODELS[agentClass] : undefined) || 'character-male-a.glb';
    const loader = new GLTFLoader();

    loader.load(
      `/assets/characters/${resolvedModelFile}`,
      (gltf) => {
        // Remove previous model
        if (modelRef.current && sceneRef.current) {
          sceneRef.current.remove(modelRef.current);
          modelRef.current = null;
          mixerRef.current = null;
        }

        const model = gltf.scene;
        model.scale.setScalar(1.0);
        model.position.set(0, 0, 0);
        model.visible = true;

        if (sceneRef.current) {
          sceneRef.current.add(model);
          modelRef.current = model;

          // Set up animations
          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(model);
            mixerRef.current = mixer;

            // Store all animations by name
            animationsRef.current.clear();
            for (const clip of gltf.animations) {
              animationsRef.current.set(clip.name.toLowerCase(), clip);
            }

            // Play initial animation based on current status
            playStatusAnimation(status);
          }
        }
      },
      undefined,
      (error) => {
        console.error('[ModelPreview] Failed to load model:', resolvedModelFile, error);
      }
    );
  }, [agentClass, modelFile, isReady]);

  // Helper function to play animation for a status
  const playStatusAnimation = (currentStatus: AgentStatus) => {
    if (!mixerRef.current) return;

    const animName = STATUS_ANIMATIONS[currentStatus];
    const clip = animationsRef.current.get(animName);

    if (!clip) {
      // Fallback to idle if animation not found
      const idleClip = animationsRef.current.get('idle');
      if (idleClip) {
        const action = mixerRef.current.clipAction(idleClip);
        action.reset().play();
        currentActionRef.current = action;
      }
      return;
    }

    const newAction = mixerRef.current.clipAction(clip);

    // Configure animation based on status
    if (currentStatus === 'working') {
      newAction.timeScale = 1.5; // Faster for working
    } else if (currentStatus === 'error') {
      newAction.setLoop(THREE.LoopOnce, 1);
      newAction.clampWhenFinished = true;
    }

    // Crossfade from current action
    if (currentActionRef.current && currentActionRef.current !== newAction) {
      currentActionRef.current.fadeOut(0.3);
      newAction.reset().fadeIn(0.3).play();
    } else {
      newAction.reset().play();
    }

    currentActionRef.current = newAction;
  };

  // Update animation and ring color when status changes
  useEffect(() => {
    if (!isReady) return;

    // Update status ring color
    if (statusRingRef.current) {
      const ringMat = statusRingRef.current.material as THREE.MeshBasicMaterial;
      ringMat.color.setHex(STATUS_COLORS[status]);

      // Pulse effect for working status
      if (status === 'working') {
        ringMat.opacity = 0.6 + Math.sin(Date.now() * 0.005) * 0.4;
      } else {
        ringMat.opacity = 0.8;
      }
    }

    // Update animation
    playStatusAnimation(status);
  }, [status, isReady]);

  return (
    <div
      ref={containerRef}
      className="model-preview"
      style={{
        width,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#1a1a24'
      }}
    />
  );
}
