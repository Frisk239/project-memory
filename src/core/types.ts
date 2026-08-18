export const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

export type MemoryEntry = {
  name: string;
  description: string;
  type: MemoryType;
  body: string;
  origin?: string;
};

export type MemoryIndexItem = {
  name: string;
  description: string;
};

export function isMemoryType(value: string): value is MemoryType {
  return (MEMORY_TYPES as readonly string[]).includes(value);
}
