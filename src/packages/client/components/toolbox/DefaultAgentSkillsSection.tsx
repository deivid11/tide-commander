/**
 * Default Agent Skills — which skills the spawn modal pre-selects.
 *
 * Every pre-selected skill is prompt overhead paid by each new agent, so this
 * is deliberately a per-installation choice rather than a fixed list. Changing
 * it only affects agents spawned from here on; existing agents keep the skills
 * they already have.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSkillsArray } from '../../store';
import {
  useDefaultAgentSkills,
  updateDefaultAgentSkills,
  resetDefaultAgentSkills,
} from '../../api/default-agent-skills';

export function DefaultAgentSkillsSection() {
  const skills = useSkillsArray();
  const defaults = useDefaultAgentSkills();

  // Local mirror so a chip reacts instantly; the server response replaces it.
  const [slugs, setSlugs] = useState<string[]>(defaults.slugs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setSlugs(defaults.slugs);
  }, [defaults.slugs]);

  // Selected first: the point of the panel is seeing what every new agent gets,
  // and the full catalog is long enough to push the selection out of view.
  // Frozen at the list this section opened with (the section unmounts when
  // collapsed, so it re-freezes on each open) so toggling a chip never makes it
  // jump out from under the cursor.
  const [pinned, setPinned] = useState<Set<string> | null>(null);
  useEffect(() => {
    // Seed from the server's answer, not from the factory fallback shown while
    // the first fetch is still in flight.
    if (defaults.loaded) setPinned(prev => prev ?? new Set(defaults.slugs));
  }, [defaults.loaded, defaults.slugs]);

  const availableSkills = useMemo(() => {
    const order = pinned ?? new Set(defaults.slugs);
    return skills
      .filter(s => s.enabled)
      .sort((a, b) => {
        const bySelection = Number(order.has(b.slug)) - Number(order.has(a.slug));
        return bySelection !== 0 ? bySelection : a.name.localeCompare(b.name);
      });
  }, [skills, pinned, defaults.slugs]);

  const filteredSkills = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableSkills;
    return availableSkills.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.slug.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query)
    );
  }, [availableSkills, search]);

  const save = useCallback(async (next: string[]) => {
    const previous = slugs;
    setSlugs(next);
    setSaving(true);
    setError(null);
    try {
      await updateDefaultAgentSkills(next);
    } catch (err: any) {
      setSlugs(previous); // Keep the UI honest about what the server actually has.
      setError(err?.message || 'Failed to save default skills');
    } finally {
      setSaving(false);
    }
  }, [slugs]);

  const toggle = useCallback((slug: string) => {
    void save(slugs.includes(slug) ? slugs.filter(s => s !== slug) : [...slugs, slug]);
  }, [save, slugs]);

  const reset = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await resetDefaultAgentSkills();
    } catch (err: any) {
      setError(err?.message || 'Failed to reset default skills');
    } finally {
      setSaving(false);
    }
  }, []);

  const selectedCount = slugs.length;
  // Slugs with no skill behind them: a deleted skill, or one from another install.
  const missingSlugs = useMemo(() => {
    const known = new Set(skills.map(s => s.slug));
    return slugs.filter(slug => !known.has(slug));
  }, [skills, slugs]);

  return (
    <div className="config-row config-row-stacked">
      <span className="config-hint">
        Skills pre-selected when you create an agent. You can still change them per agent, and
        agents that already exist are not affected. Each selected skill is added to every new
        agent's prompt, so fewer means more room for the actual work.
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="config-input"
          placeholder="Search skills..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: '1 1 160px', minWidth: 0 }}
        />
        <span className="config-hint" style={{ whiteSpace: 'nowrap' }}>
          {selectedCount} selected
        </span>
        <button
          type="button"
          className="config-button"
          onClick={() => void reset()}
          disabled={saving || !defaults.configured}
          title={defaults.configured ? 'Go back to the skills Tide Commander ships with' : 'Already using the shipped defaults'}
        >
          Reset
        </button>
      </div>

      {error && (
        <span className="config-hint" style={{ color: 'var(--color-danger, #e5534b)', marginTop: '6px' }}>
          {error}
        </span>
      )}

      {missingSlugs.length > 0 && (
        <span className="config-hint" style={{ marginTop: '6px' }}>
          Not installed here, ignored when spawning: {missingSlugs.join(', ')}
        </span>
      )}

      <div className="agent-names-list" style={{ flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
        {filteredSkills.map(skill => (
          <div
            key={skill.id}
            className={`agent-name-chip${slugs.includes(skill.slug) ? ' agent-name-chip--selected' : ''}`}
            style={{ cursor: saving ? 'wait' : 'pointer', userSelect: 'none' }}
            title={skill.description}
            onClick={() => { if (!saving) toggle(skill.slug); }}
          >
            <span className="agent-name-text">{skill.name}</span>
          </div>
        ))}
        {filteredSkills.length === 0 && (
          <span className="config-hint">No skills match "{search}".</span>
        )}
      </div>
    </div>
  );
}
