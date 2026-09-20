import {
  applyPlan, editBoard, establishPlanningContext, generatePlan, getBoard, getCommittedBoard, getPlanningContext,
  sendConversation,
  type GeneratePlanRequest,
} from '../../../../shared/planner/api-client'

// Wrap fetch so calling it as `deps.fetchImpl(...)` doesn't rebind `this` to the
// deps object — a bare `fetch` reference throws "Illegal invocation" in browsers.
const browserFetch = ((url: string, init?: unknown) => fetch(url, init as RequestInit)) as never
export const defaultGetBoard = (programId: string) =>
  getBoard({ fetchImpl: browserFetch, baseUrl: '' }, programId)
export const defaultGenerate = (req: GeneratePlanRequest) =>
  generatePlan({ fetchImpl: browserFetch, baseUrl: '' }, req)
export const defaultApply = (req: Parameters<typeof applyPlan>[1]) =>
  applyPlan({ fetchImpl: browserFetch, baseUrl: '' }, req)
export const defaultCommittedBoard = (programId: string) =>
  getCommittedBoard({ fetchImpl: browserFetch, baseUrl: '' }, programId)
export const defaultEditBoard = (req: Parameters<typeof editBoard>[1]) =>
  editBoard({ fetchImpl: browserFetch, baseUrl: '' }, req)
export const defaultEstablishPlanningContext = (req: Parameters<typeof establishPlanningContext>[1]) =>
  establishPlanningContext({ fetchImpl: browserFetch, baseUrl: '' }, req)
export const defaultPlanningContext = (programId: string) =>
  getPlanningContext({ fetchImpl: browserFetch, baseUrl: '' }, programId)
export const defaultSendConversation = (req: Parameters<typeof sendConversation>[1]) =>
  sendConversation({ fetchImpl: browserFetch, baseUrl: '' }, req)
