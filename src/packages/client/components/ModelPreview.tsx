import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AgentClass, AgentStatus } from '../../shared/types';
import { AGENT_CLASS_MODELS } from '../scene/config';
import { authUrl } from '../utils/storage';

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
  customModelFile?: File;  // Custom uploaded model file (File object)
  customModelUrl?: string;  // URL to custom model (e.g., /api/custom-models/:classId)
  modelScale?: number;  // Scale multiplier for the model
  modelOffset?: { x: number; y: number; z: number };  // Position offset for centering the model
  idleAnimation?: string;  // Override idle animation name (from animation mapping). Undefined = use default, empty string = no animation (static)
  status?: AgentStatus;
  width?: number;
  height?: number;
}

export function ModelPreview({ agentClass, modelFile, customModelFile, customModelUrl, modelScale = 1.0, modelOffset, idleAnimation, status = 'idle', width = 150, height = 200 }: ModelPreviewProps) {
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
  const [webglFailed, setWebglFailed] = useState(false);
  const hasAnimationsRef = useRef(false);
  const proceduralTimeRef = useRef(0);
  const basePositionRef = useRef(new THREE.Vector3());

  // Drag-to-rotate state
  const isDraggingRef = useRef(false);
  const previousMouseRef = useRef({ x: 0, y: 0 });
  const modelRotationRef = useRef({ x: 0, y: 0 });

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setWebglFailed(false);

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
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      console.warn('[ModelPreview] WebGL context creation failed — too many active contexts');
      setWebglFailed(true);
      return;
    }
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

    // Mouse event handlers for drag-to-rotate
    const handleMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      previousMouseRef.current = { x: e.clientX, y: e.clientY };
      container.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !modelRef.current) return;

      const deltaX = e.clientX - previousMouseRef.current.x;
      const deltaY = e.clientY - previousMouseRef.current.y;

      // Update rotation (Y-axis for horizontal drag, X-axis for vertical drag)
      modelRotationRef.current.y += deltaX * 0.01;
      modelRotationRef.current.x += deltaY * 0.01;

      // Clamp vertical rotation to prevent flipping
      modelRotationRef.current.x = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, modelRotationRef.current.x));

      modelRef.current.rotation.y = modelRotationRef.current.y;
      modelRef.current.rotation.x = modelRotationRef.current.x;

      previousMouseRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      container.style.cursor = 'grab';
    };

    const handleMouseLeave = () => {
      isDraggingRef.current = false;
      container.style.cursor = 'grab';
    };

    // Add event listeners
    container.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mouseleave', handleMouseLeave);
    container.style.cursor = 'grab';

    // Animation loop (no auto-rotation)
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      const delta = clockRef.current.getDelta();

      // Update animations
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      } else if (modelRef.current && !hasAnimationsRef.current) {
        // Apply procedural animation for models without animations
        proceduralTimeRef.current += delta;
        const t = proceduralTimeRef.current;

        // Gentle bobbing
        const bobAmount = 0.02;
        const bobSpeed = 1.5;
        const yOffset = Math.sin(t * bobSpeed) * bobAmount;

        // Subtle sway
        const swayAmount = 0.01;
        const swaySpeed = 0.8;
        const xOffset = Math.sin(t * swaySpeed) * swayAmount;

        modelRef.current.position.set(
          basePositionRef.current.x + xOffset,
          basePositionRef.current.y + yOffset,
          basePositionRef.current.z
        );
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    // Cleanup
    return () => {
      cancelAnimationFrame(animationIdRef.current);
      container.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mouseleave', handleMouseLeave);

      // Dispose model and its resources
      if (modelRef.current && sceneRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => {
                if (m.map) m.map.dispose();
                m.dispose();
              });
            } else if (child.material) {
              if ((child.material as THREE.MeshStandardMaterial).map) {
                (child.material as THREE.MeshStandardMaterial).map?.dispose();
              }
              child.material.dispose();
            }
          }
        });
        modelRef.current = null;
      }

      // Dispose status ring
      if (statusRingRef.current && sceneRef.current) {
        sceneRef.current.remove(statusRingRef.current);
        statusRingRef.current.geometry.dispose();
        (statusRingRef.current.material as THREE.Material).dispose();
        statusRingRef.current = null;
      }

      // Dispose ground and other scene objects
      if (sceneRef.current) {
        sceneRef.current.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            if (child.material instanceof THREE.Material) {
              child.material.dispose();
            }
          }
        });
        sceneRef.current.clear();
      }

      // Clear animation data
      mixerRef.current = null;
      currentActionRef.current = null;
      animationsRef.current.clear();

      // Force WebGL context loss before disposing renderer
      if (rendererRef.current) {
        try {
          const gl = rendererRef.current.getContext();
          const loseContext = gl.getExtension('WEBGL_lose_context');
          if (loseContext) {
            loseContext.loseContext();
          }
        } catch {
          // Context may already be lost
        }
        rendererRef.current.dispose();
        if (container.contains(rendererRef.current.domElement)) {
          container.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current = null;
      }

      sceneRef.current = null;
      cameraRef.current = null;
      setIsReady(false);
    };
  }, [width, height]);

  // Load model when agentClass/modelFile/customModel changes or when ready
  useEffect(() => {
    if (!isReady || !sceneRef.current) return;

    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    let blobUrl: string | null = null;

    // Helper to process loaded model
    const processModel = (gltf: { scene: THREE.Group; animations: THREE.AnimationClip[] }) => {
      // Remove previous model
      if (modelRef.current && sceneRef.current) {
        sceneRef.current.remove(modelRef.current);
        modelRef.current = null;
        mixerRef.current = null;
        currentActionRef.current = null;
      }

      const model = gltf.scene;
      model.scale.setScalar(modelScale);
      // Apply position offset (x: horizontal, y: depth/forward-back, z: vertical height)
      const offsetX = modelOffset?.x ?? 0;
      const offsetY = modelOffset?.y ?? 0;
      const offsetZ = modelOffset?.z ?? 0;
      model.position.set(offsetX, offsetZ, offsetY);
      model.visible = true;

      // Reset rotation for new model
      modelRotationRef.current = { x: 0, y: 0 };
      model.rotation.set(0, 0, 0);

      // Enable shadows and fix materials
      model.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.map) {
              mat.map.colorSpace = THREE.SRGBColorSpace;
            }
          }
        }
      });

      if (sceneRef.current) {
        sceneRef.current.add(model);
        modelRef.current = model;

        // Store base position for procedural animation
        basePositionRef.current.copy(model.position);

        // Set up animations
        if (gltf.animations.length > 0) {
          hasAnimationsRef.current = true;
          const mixer = new THREE.AnimationMixer(model);
          mixerRef.current = mixer;

          // Store all animations by name
          animationsRef.current.clear();
          for (const clip of gltf.animations) {
            animationsRef.current.set(clip.name.toLowerCase(), clip);
          }

          // Play idle animation based on idleAnimation prop
          // If idleAnimation is '' (none/empty), don't play any animation (static)
          if (idleAnimation !== '') {
            const targetClip = idleAnimation
              ? (animationsRef.current.get(idleAnimation.toLowerCase()) || gltf.animations[0])
              : (animationsRef.current.get('idle') || gltf.animations[0]);
            if (targetClip) {
              const action = mixer.clipAction(targetClip);
              action.reset().play();
              currentActionRef.current = action;
            }
          }
        } else {
          // No animations - will use procedural animation
          hasAnimationsRef.current = false;
          mixerRef.current = null;
          animationsRef.current.clear();
        }
      }
    };

    // Determine what to load
    if (customModelFile) {
      // Load from File object (blob URL)
      blobUrl = URL.createObjectURL(customModelFile);
      console.log('[ModelPreview] Loading custom model from file:', customModelFile.name, 'blob URL:', blobUrl);
      loader.load(
        blobUrl,
        (gltf) => {
          console.log('[ModelPreview] Successfully loaded custom model file, animations:', gltf.animations.length);
          processModel(gltf);
        },
        undefined,
        (error) => {
          console.error('[ModelPreview] Failed to load custom model file:', error);
        }
      );
    } else if (customModelUrl) {
      // Load from custom model URL (server endpoint)
      // Use authUrl to append token for XHR requests that don't support custom headers
      const authenticatedUrl = authUrl(customModelUrl);
      console.log('[ModelPreview] Loading custom model from URL:', customModelUrl);
      loader.load(
        authenticatedUrl,
        (gltf) => {
          console.log('[ModelPreview] Successfully loaded custom model URL, animations:', gltf.animations.length);
          processModel(gltf);
        },
        undefined,
        (error) => {
          console.error('[ModelPreview] Failed to load custom model URL:', customModelUrl, error);
        }
      );
    } else {
      // Use direct modelFile if provided, otherwise look up from agent class
      // Fallback to default model if agent class isn't in the map (e.g., custom classes)
      const resolvedModelFile = modelFile || (agentClass ? AGENT_CLASS_MODELS[agentClass] : undefined) || 'character-male-a.glb';
      loader.load(
        `/assets/characters/${resolvedModelFile}`,
        processModel,
        undefined,
        (error) => {
          console.error('[ModelPreview] Failed to load model:', resolvedModelFile, error);
        }
      );
    }

    // Cleanup blob URL and DRACOLoader on unmount or when dependencies change
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
      dracoLoader.dispose();
    };
  }, [agentClass, modelFile, customModelFile, customModelUrl, modelScale, modelOffset, isReady]);

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

  // Update animation when idleAnimation prop changes
  useEffect(() => {
    if (!isReady || !mixerRef.current) return;
    if (status !== 'idle') return;

    // idleAnimation === '' means "none" — stop all animations
    if (idleAnimation === '') {
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }
      return;
    }

    // Play the specified idle animation, or fall back to default
    const targetName = idleAnimation
      ? idleAnimation.toLowerCase()
      : 'idle';
    const clip = animationsRef.current.get(targetName);
    if (clip) {
      const newAction = mixerRef.current.clipAction(clip);
      if (currentActionRef.current && currentActionRef.current !== newAction) {
        currentActionRef.current.fadeOut(0.3);
        newAction.reset().fadeIn(0.3).play();
      } else {
        newAction.reset().play();
      }
      currentActionRef.current = newAction;
    } else {
      // Animation not found — stop
      if (currentActionRef.current) {
        currentActionRef.current.stop();
        currentActionRef.current = null;
      }
    }
  }, [idleAnimation, isReady, status]);

  if (webglFailed) {
    return (
      <div
        className="model-preview"
        style={{
          width,
          height,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#1a1a24',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 12,
          textAlign: 'center' as const,
          padding: 8,
        }}
      >
        3D preview unavailable
      </div>
    );
  }

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
