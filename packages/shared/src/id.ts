/** 生成带前缀的唯一 ID，如 `prof_ab12...` */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
