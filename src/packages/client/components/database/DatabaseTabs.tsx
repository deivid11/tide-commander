/**
 * DatabaseTabs
 *
 * Tab management component for opening multiple databases at once.
 * Each tab represents an open database connection.
 */

import React from 'react';
import './DatabaseTabs.scss';

export interface DatabaseTab {
  id: string; // unique tab id: connectionId:database
  connectionId: string;
  connectionName: string;
  database: string;
}

interface DatabaseTabsProps {
  tabs: DatabaseTab[];
  activeTabId: string | null;
  onTabClick: (tab: DatabaseTab) => void;
  onTabClose: (tabId: string) => void;
}

export const DatabaseTabs: React.FC<DatabaseTabsProps> = ({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
}) => {
  return (
    <div className="database-tabs">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`database-tabs__tab ${
            activeTabId === tab.id ? 'database-tabs__tab--active' : ''
          }`}
        >
          <button
            className="database-tabs__tab-label"
            onClick={() => onTabClick(tab)}
            title={`${tab.connectionName} / ${tab.database}`}
          >
            {tab.database}
            <span className="database-tabs__tab-connection">{tab.connectionName}</span>
          </button>
          <button
            className="database-tabs__tab-close"
            onClick={() => onTabClose(tab.id)}
            title="Close tab"
            aria-label={`Close ${tab.database} tab`}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
};
