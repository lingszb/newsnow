import type { SourceID } from "./types"

export interface IndustryDefinition {
  code: string
  path: string
  name: string
  description: string
}

export const industryDefinitions = [
  {
    code: "TECH",
    path: "tech",
    name: "科技",
    description: "AI、互联网、软件、硬件、通信、科学技术",
  },
  {
    code: "FINANCE",
    path: "finance",
    name: "金融",
    description: "股票、基金、银行、投资、宏观经济、商业财经",
  },
  {
    code: "CONSUMER",
    path: "consumer",
    name: "消费",
    description: "零售、电商、汽车、旅游、餐饮、生活消费",
  },
  {
    code: "HEALTH",
    path: "health",
    name: "医疗健康",
    description: "医疗、医药、生物科技、健康",
  },
  {
    code: "ENTERTAINMENT_SPORTS",
    path: "entertainment-sports",
    name: "文娱体育",
    description: "影视、游戏、音乐、文化、明星、体育",
  },
  {
    code: "OTHER",
    path: "other",
    name: "其他",
    description: "社会、政务、国际综合及无法归入以上行业的内容",
  },
] satisfies IndustryDefinition[]

export type IndustryCode = string
export type IndustryPath = string
export type IndustrySort = "hot" | "latest"

export const industryCodes = industryDefinitions.map(item => item.code)

export function industryFromPath(path: string, definitions: IndustryDefinition[] = industryDefinitions) {
  return definitions.find(item => item.path === path.toLowerCase())
}

export function industryByCode(code: IndustryCode, definitions: IndustryDefinition[] = industryDefinitions) {
  return definitions.find(item => item.code === code)
}

export interface IndustryCount {
  code: IndustryCode
  path: IndustryPath
  name: string
  description: string
  count: number
}

export interface IndustryArticle {
  id: string
  sourceId: SourceID
  sourceName: string
  sourceTitle?: string
  title: string
  url: string
  mobileUrl?: string
  summary?: string
  publishedAt: number
  rank: number
  industry: IndustryCode
  confidence: number
}

export interface IndustryNewsResponse {
  items: IndustryArticle[]
  nextCursor?: string
}

export interface IndustryStatusResponse {
  running: boolean
  lastStartedAt?: number
  lastCompletedAt?: number
  successfulSources: number
  failedSources: number
  skippedRuns: number
  pendingClassifications: number
  failedClassifications: number
  classifierEnabled: boolean
  classifierConfigured: boolean
}
