import React from 'react';
import type { Agent, AgentProvider } from '../../shared/types';
import {
  piModelProviderAssetUrl,
  piModelProviderLabel,
  providerAgentTitle,
  providerAssetUrl,
  resolvePiModelProvider,
} from '../utils/providerDisplay';

interface ProviderIconProps {
  agent?: Pick<Agent, 'provider' | 'piModel' | 'piModelProvider'>;
  provider?: AgentProvider | string;
  piModel?: string;
  piModelProvider?: string;
  className?: string;
  alt?: string;
  title?: string;
  draggable?: boolean;
}

/**
 * Harness badge. Pi agents render the model provider and Pi as an overlapping
 * pair, so the model vendor is never mistaken for the harness running it.
 */
export const ProviderIcon = React.memo(function ProviderIcon({
  agent,
  provider: providerProp,
  piModel: piModelProp,
  piModelProvider: piModelProviderProp,
  className,
  alt,
  title,
  draggable = false,
}: ProviderIconProps) {
  const provider = providerProp ?? agent?.provider;
  const piModel = piModelProp ?? agent?.piModel;
  const modelProvider = resolvePiModelProvider(
    piModel,
    piModelProviderProp ?? agent?.piModelProvider,
  );
  const resolvedTitle = title ?? providerAgentTitle(provider, piModel, modelProvider);
  const decorative = alt === '';

  if (provider !== 'pi' || !modelProvider) {
    return (
      <img
        src={providerAssetUrl(provider, import.meta.env.BASE_URL)}
        alt={alt ?? resolvedTitle}
        className={className}
        title={resolvedTitle}
        aria-hidden={decorative ? 'true' : undefined}
        draggable={draggable}
      />
    );
  }

  const sourceAsset = piModelProviderAssetUrl(modelProvider, import.meta.env.BASE_URL);
  const sourceLabel = piModelProviderLabel(modelProvider);

  return (
    <span
      className={`provider-icon-pi-source${className ? ` ${className}` : ''}`}
      title={resolvedTitle}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : (alt ?? resolvedTitle)}
      aria-hidden={decorative ? 'true' : undefined}
    >
      {sourceAsset ? (
        <img
          className="provider-icon-pi-source__image"
          src={sourceAsset}
          alt=""
          aria-hidden="true"
          draggable={draggable}
        />
      ) : (
        <span className="provider-icon-pi-source__fallback" aria-hidden="true">
          {sourceLabel.slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );
});
