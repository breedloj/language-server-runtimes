import {
    QueryInlineProjectContextParams,
    QueryInlineProjectContextResult,
    QueryVectorIndexParams,
    QueryVectorIndexResult,
} from '../protocol'

export type Project = {
    queryInlineProjectContext: (params: QueryInlineProjectContextParams) => Promise<QueryInlineProjectContextResult>
    queryVectorIndex: (params: QueryVectorIndexParams) => Promise<QueryVectorIndexResult>
}
