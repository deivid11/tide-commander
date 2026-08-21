import { useSyncExternalStore } from 'react';
import {
  getOpenPluginModal,
  getPluginCatalog,
  getPluginModals,
  getPluginRegistryRevision,
  getPluginSidebarViews,
  subscribePluginRegistry,
} from './registry';

export function usePluginRegistryRevision(): number {
  return useSyncExternalStore(
    subscribePluginRegistry,
    getPluginRegistryRevision,
    getPluginRegistryRevision,
  );
}

export function usePluginCatalog() {
  usePluginRegistryRevision();
  return getPluginCatalog();
}

export function usePluginSidebarViews() {
  usePluginRegistryRevision();
  return getPluginSidebarViews();
}

export function usePluginModals() {
  usePluginRegistryRevision();
  return getPluginModals();
}

export function useOpenPluginModal() {
  usePluginRegistryRevision();
  return getOpenPluginModal();
}
