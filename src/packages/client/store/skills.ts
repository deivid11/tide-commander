/**
 * Skills Store Actions
 *
 * Handles skills and custom agent classes management.
 */

import type { ClientMessage, Skill, CustomAgentClass } from '../../shared/types';
import type { StoreState } from './types';

export interface SkillActions {
  // Skills CRUD
  setSkillsFromServer(skillsArray: Skill[]): void;
  addSkillFromServer(skill: Skill): void;
  updateSkillFromServer(skill: Skill): void;
  removeSkillFromServer(skillId: string): void;
  getSkill(skillId: string): Skill | undefined;
  getAllSkills(): Skill[];
  getSkillsForAgent(agentId: string): Skill[];
  createSkill(skillData: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): void;
  updateSkill(skillId: string, updates: Partial<Skill>): void;
  deleteSkill(skillId: string): void;
  assignSkillToAgent(skillId: string, agentId: string): void;
  unassignSkillFromAgent(skillId: string, agentId: string): void;
  requestAgentSkills(agentId: string): void;

  // Custom Agent Classes CRUD
  setCustomAgentClassesFromServer(classesArray: CustomAgentClass[]): void;
  addCustomAgentClassFromServer(customClass: CustomAgentClass): void;
  updateCustomAgentClassFromServer(customClass: CustomAgentClass): void;
  removeCustomAgentClassFromServer(classId: string): void;
  getCustomAgentClass(classId: string): CustomAgentClass | undefined;
  getAllCustomAgentClasses(): CustomAgentClass[];
  createCustomAgentClass(classData: Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>): void;
  updateCustomAgentClass(classId: string, updates: Partial<CustomAgentClass>): void;
  deleteCustomAgentClass(classId: string): void;
}

export function createSkillActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getSendMessage: () => ((msg: ClientMessage) => void) | null
): SkillActions {
  return {
    // ============================================================================
    // Skills
    // ============================================================================

    setSkillsFromServer(skillsArray: Skill[]): void {
      setState((state) => {
        const newSkills = new Map<string, Skill>();
        for (const skill of skillsArray) {
          newSkills.set(skill.id, skill);
        }
        state.skills = newSkills;
      });
      notify();
    },

    addSkillFromServer(skill: Skill): void {
      setState((state) => {
        const newSkills = new Map(state.skills);
        newSkills.set(skill.id, skill);
        state.skills = newSkills;
      });
      notify();
    },

    updateSkillFromServer(skill: Skill): void {
      setState((state) => {
        const newSkills = new Map(state.skills);
        newSkills.set(skill.id, skill);
        state.skills = newSkills;
      });
      notify();
    },

    removeSkillFromServer(skillId: string): void {
      setState((state) => {
        const newSkills = new Map(state.skills);
        newSkills.delete(skillId);
        state.skills = newSkills;
      });
      notify();
    },

    getSkill(skillId: string): Skill | undefined {
      return getState().skills.get(skillId);
    },

    getAllSkills(): Skill[] {
      return Array.from(getState().skills.values());
    },

    getSkillsForAgent(agentId: string): Skill[] {
      const state = getState();
      const agent = state.agents.get(agentId);
      if (!agent) return [];

      return Array.from(state.skills.values()).filter((skill) => {
        if (!skill.enabled) return false;
        if (skill.assignedAgentIds.includes(agentId)) return true;
        if (skill.assignedAgentClasses.includes(agent.class)) return true;
        return false;
      });
    },

    createSkill(skillData: Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>): void {
      getSendMessage()?.({
        type: 'create_skill',
        payload: skillData,
      });
    },

    updateSkill(skillId: string, updates: Partial<Skill>): void {
      getSendMessage()?.({
        type: 'update_skill',
        payload: { id: skillId, updates },
      });
    },

    deleteSkill(skillId: string): void {
      getSendMessage()?.({
        type: 'delete_skill',
        payload: { id: skillId },
      });
    },

    assignSkillToAgent(skillId: string, agentId: string): void {
      getSendMessage()?.({
        type: 'assign_skill',
        payload: { skillId, agentId },
      });
    },

    unassignSkillFromAgent(skillId: string, agentId: string): void {
      getSendMessage()?.({
        type: 'unassign_skill',
        payload: { skillId, agentId },
      });
    },

    requestAgentSkills(agentId: string): void {
      getSendMessage()?.({
        type: 'request_agent_skills',
        payload: { agentId },
      });
    },

    // ============================================================================
    // Custom Agent Classes
    // ============================================================================

    setCustomAgentClassesFromServer(classesArray: CustomAgentClass[]): void {
      setState((state) => {
        const newClasses = new Map<string, CustomAgentClass>();
        for (const customClass of classesArray) {
          newClasses.set(customClass.id, customClass);
        }
        state.customAgentClasses = newClasses;
      });
      notify();
    },

    addCustomAgentClassFromServer(customClass: CustomAgentClass): void {
      setState((state) => {
        const newClasses = new Map(state.customAgentClasses);
        newClasses.set(customClass.id, customClass);
        state.customAgentClasses = newClasses;
      });
      notify();
    },

    updateCustomAgentClassFromServer(customClass: CustomAgentClass): void {
      setState((state) => {
        const newClasses = new Map(state.customAgentClasses);
        newClasses.set(customClass.id, customClass);
        state.customAgentClasses = newClasses;
      });
      notify();
    },

    removeCustomAgentClassFromServer(classId: string): void {
      setState((state) => {
        const newClasses = new Map(state.customAgentClasses);
        newClasses.delete(classId);
        state.customAgentClasses = newClasses;
      });
      notify();
    },

    getCustomAgentClass(classId: string): CustomAgentClass | undefined {
      return getState().customAgentClasses.get(classId);
    },

    getAllCustomAgentClasses(): CustomAgentClass[] {
      return Array.from(getState().customAgentClasses.values());
    },

    createCustomAgentClass(classData: Omit<CustomAgentClass, 'id' | 'createdAt' | 'updatedAt'>): void {
      getSendMessage()?.({
        type: 'create_custom_agent_class',
        payload: classData,
      });
    },

    updateCustomAgentClass(classId: string, updates: Partial<CustomAgentClass>): void {
      getSendMessage()?.({
        type: 'update_custom_agent_class',
        payload: { id: classId, updates },
      });
    },

    deleteCustomAgentClass(classId: string): void {
      getSendMessage()?.({
        type: 'delete_custom_agent_class',
        payload: { id: classId },
      });
    },
  };
}
