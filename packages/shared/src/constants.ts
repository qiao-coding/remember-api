/** 全局常量与默认值 */

/** 默认 Memory Budget（tokens） */
export const DEFAULT_MEMORY_BUDGET = 1500;

/** L0 用户偏好目标 token 区间（文档） */
export const L0_PREFERENCE_TARGET = { min: 100, max: 500 };

/** L1 项目摘要目标 token 区间（文档） */
export const L1_PROJECT_SUMMARY_TARGET = { min: 300, max: 1000 };

/** Memory Overhead 验收目标（文档：≤5%~10%） */
export const MEMORY_OVERHEAD_LIMIT = 0.1;

/** API Key 前缀 */
export const API_KEY_PREFIX = "rma_";

/** API Key 明文长度 */
export const API_KEY_LENGTH = 40;
