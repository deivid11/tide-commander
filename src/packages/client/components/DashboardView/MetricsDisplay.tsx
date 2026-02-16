import React from 'react';
import { useTranslation } from 'react-i18next';
import { DashboardMetrics } from './types';
import styles from './dashboard-view.module.scss';

interface MetricsDisplayProps {
  metrics: DashboardMetrics;
}

/**
 * Individual metric card
 */
const MetricCard = React.memo(
  ({
    label,
    value,
    unit,
    icon,
    trend,
    color,
  }: {
    label: string;
    value: number | string;
    unit?: string;
    icon: string;
    trend?: 'up' | 'down' | 'stable';
    color: 'healthy' | 'working' | 'error' | 'neutral';
  }) => {
    return (
      <div className={`${styles['metric-card']} ${styles[`metric-card--${color}`]}`}>
        <div className={styles['metric-card__icon']}>{icon}</div>
        <div className={styles['metric-card__content']}>
          <p className={styles['metric-card__label']}>{label}</p>
          <div className={styles['metric-card__value-container']}>
            <span className={styles['metric-card__value']}>{value}</span>
            {unit && <span className={styles['metric-card__unit']}>{unit}</span>}
            {trend && (
              <span
                className={`${styles['metric-card__trend']} ${styles[`metric-card__trend--${trend}`]}`}
              >
                {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
);

MetricCard.displayName = 'MetricCard';

/**
 * Progress bar with percentage
 */
const ProgressBar = React.memo(
  ({ label, value, color }: { label: string; value: number; color: 'healthy' | 'working' | 'error' }) => {
    return (
      <div className={styles['progress-metric']}>
        <div className={styles['progress-metric__header']}>
          <span className={styles['progress-metric__label']}>{label}</span>
          <span className={styles['progress-metric__value']}>{value}%</span>
        </div>
        <div className={styles['progress-metric__bar']}>
          <div
            className={`${styles['progress-metric__fill']} ${styles[`progress-metric__fill--${color}`]}`}
            style={{ width: `${value}%` }}
          />
        </div>
      </div>
    );
  }
);

ProgressBar.displayName = 'ProgressBar';

/**
 * Main Metrics Display component
 */
export const MetricsDisplay: React.FC<MetricsDisplayProps> = ({ metrics }) => {
  const { t } = useTranslation(['dashboard']);
  const agentHealthy = metrics.totalAgents > 0
    ? Math.round(((metrics.totalAgents - metrics.errorAgents) / metrics.totalAgents) * 100)
    : 0;

  const buildingHealthy = metrics.totalBuildings > 0
    ? Math.round((metrics.healthyBuildings / metrics.totalBuildings) * 100)
    : 0;

  return (
    <div className={styles['metrics-display']}>
      <div className={styles['metrics-display__header']}>
        <h2 className={styles['metrics-display__title']}>{t('metricsDisplay.title')}</h2>
      </div>

      {/* Key Metrics Grid */}
      <div className={styles['metrics-display__grid']}>
        <MetricCard
          label={t('metricsDisplay.activeAgents')}
          value={metrics.activeAgents}
          unit={`/ ${metrics.totalAgents}`}
          icon="🤖"
          color={metrics.activeAgents > 0 ? 'working' : 'neutral'}
          trend={metrics.activeAgents > 0 ? 'up' : 'stable'}
        />
        <MetricCard
          label={t('metricsDisplay.healthyAgents')}
          value={metrics.totalAgents - metrics.errorAgents}
          unit={`/ ${metrics.totalAgents}`}
          icon="✓"
          color={agentHealthy >= 80 ? 'healthy' : agentHealthy >= 50 ? 'working' : 'error'}
        />
        <MetricCard
          label={t('metricsDisplay.agentErrors')}
          value={metrics.errorAgents}
          icon="⚠️"
          color={metrics.errorAgents === 0 ? 'healthy' : metrics.errorAgents <= 2 ? 'working' : 'error'}
          trend={metrics.errorAgents === 0 ? 'down' : 'stable'}
        />
        <MetricCard
          label={t('metricsDisplay.healthyBuildings')}
          value={metrics.healthyBuildings}
          unit={`/ ${metrics.totalBuildings}`}
          icon="🏢"
          color={buildingHealthy >= 80 ? 'healthy' : buildingHealthy >= 50 ? 'working' : 'error'}
        />
      </div>

      {/* Rates Section */}
      <div className={styles['metrics-display__section']}>
        <h3 className={styles['metrics-display__section-title']}>{t('metricsDisplay.performanceRates')}</h3>
        <div className={styles['metrics-display__rates']}>
          <ProgressBar
            label={t('metricsDisplay.taskCompletion')}
            value={metrics.taskCompletionRate}
            color={metrics.taskCompletionRate >= 70 ? 'healthy' : 'working'}
          />
          <ProgressBar
            label={t('metricsDisplay.errorRate')}
            value={metrics.errorRate}
            color={metrics.errorRate <= 20 ? 'healthy' : metrics.errorRate <= 50 ? 'working' : 'error'}
          />
          <ProgressBar
            label={t('metricsDisplay.buildingHealth')}
            value={buildingHealthy}
            color={buildingHealthy >= 80 ? 'healthy' : buildingHealthy >= 50 ? 'working' : 'error'}
          />
        </div>
      </div>

      {/* Recent Errors */}
      {metrics.recentErrors.length > 0 && (
        <div className={styles['metrics-display__section']}>
          <h3 className={styles['metrics-display__section-title']}>
            {t('metricsDisplay.recentErrors')} ({metrics.recentErrors.length})
          </h3>
          <div className={styles['metrics-display__errors']}>
            {metrics.recentErrors.map((error) => (
              <div key={error.id} className={styles['error-item']}>
                <div className={styles['error-item__header']}>
                  <span className={styles['error-item__agent']}>{error.agentName}</span>
                  <span className={styles['error-item__time']}>
                    {new Date(error.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <p className={styles['error-item__message']}>{error.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

MetricsDisplay.displayName = 'MetricsDisplay';
