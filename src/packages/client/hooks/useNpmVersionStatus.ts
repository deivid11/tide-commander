import { useCallback, useEffect, useState } from 'react';
import { checkNpmVersion, type VersionRelation } from '../../shared/version';

const PACKAGE_NAME = 'tide-commander';
const CURRENT_VERSION = __APP_VERSION__;

type NpmVersionState = {
  currentVersion: string;
  latestVersion: string | null;
  relation: VersionRelation;
  isChecking: boolean;
};

export function useNpmVersionStatus() {
  const [state, setState] = useState<NpmVersionState>({
    currentVersion: CURRENT_VERSION,
    latestVersion: null,
    relation: 'unknown',
    isChecking: false,
  });

  const refresh = useCallback(async () => {
    setState(prev => ({ ...prev, isChecking: true }));
    const result = await checkNpmVersion(PACKAGE_NAME, CURRENT_VERSION);
    setState({
      currentVersion: CURRENT_VERSION,
      latestVersion: result.latestVersion,
      relation: result.relation,
      isChecking: false,
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
  };
}

declare const __APP_VERSION__: string;
