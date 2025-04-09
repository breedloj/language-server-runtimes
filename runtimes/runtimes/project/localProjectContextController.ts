import {
    Logging,
    QueryInlineProjectContextParams,
    QueryInlineProjectContextResult,
    QueryVectorIndexParams,
    QueryVectorIndexResult,
    WorkspaceFolder,
} from '@aws/language-server-runtimes/server-interface'
import { dirname } from 'path'
import type { UpdateMode, VectorLibAPI } from 'local-indexing'

const fs = require('fs').promises
const path = require('path')
const LIBRARY_DIR = path.join(dirname(require.main!.filename), 'indexing')

export class LocalProjectContextController {
    private readonly fileExtensions: string[]
    private readonly workspaceFolders: WorkspaceFolder[]
    private readonly clientName: string
    private _vecLib?: VectorLibAPI
    private log: Logging

    constructor(clientName: string, workspaceFolders: WorkspaceFolder[], logging: Logging) {
        this.fileExtensions = ['.java']
        this.workspaceFolders = workspaceFolders
        this.clientName = clientName
        this.log = logging
    }

    public async init(vectorLib?: any): Promise<void> {
        try {
            const vecLib = vectorLib ?? (await import(path.join(LIBRARY_DIR, 'dist', 'extension.js')))
            const root = this.findCommonWorkspaceRoot(this.workspaceFolders)
            this._vecLib = await vecLib.start(LIBRARY_DIR, this.clientName, root)
        } catch (error) {
            this.log.error('Vector library failed to initialize:' + error)
        }
        await this.updateConfiguration()
    }

    public async dispose(): Promise<void> {
        if (this._vecLib) {
            await this._vecLib?.clear?.()
            this._vecLib = undefined
        }
    }

    public async updateConfiguration(): Promise<void> {
        try {
            if (this._vecLib) {
                const sourceFiles = await this.processWorkspaceFolders(this.workspaceFolders)
                const rootDir = this.findCommonWorkspaceRoot(this.workspaceFolders)
                await this._vecLib?.buildIndex(sourceFiles, rootDir, 'all')
            }
        } catch (error) {
            this.log.error(`Error in GetConfiguration: ${error}`)
        }
    }

    public async updateIndex(filePaths: string[], operation: UpdateMode): Promise<void> {
        if (!this._vecLib) {
            return
        }

        try {
            await this._vecLib?.updateIndexV2(filePaths, operation)
        } catch (error) {
            this.log.error(`Error updating index: ${error}`)
        }
    }

    public async queryInlineProjectContext(
        params: QueryInlineProjectContextParams
    ): Promise<QueryInlineProjectContextResult> {
        if (!this._vecLib) {
            return { inlineProjectContext: [] }
        }

        try {
            const resp = await this._vecLib?.queryInlineProjectContext(params.query, params.filePath, params.target)
            return { inlineProjectContext: resp ?? [] }
        } catch (error) {
            this.log.error(`Error in queryInlineProjectContext: ${error}`)
            return { inlineProjectContext: [] }
        }
    }

    public async queryVectorIndex(params: QueryVectorIndexParams): Promise<QueryVectorIndexResult> {
        if (!this._vecLib) {
            return { chunks: [] }
        }

        try {
            const resp = await this._vecLib?.queryVectorIndex(params.query)
            return { chunks: resp ?? [] }
        } catch (error) {
            this.log.error(`Error in queryVectorIndex: ${error}`)
            return { chunks: [] }
        }
    }

    private async processWorkspaceFolders(workspaceFolders?: WorkspaceFolder[] | null): Promise<string[]> {
        const workspaceSourceFiles: string[] = []
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const folderPath = new URL(folder.uri).pathname
                this.log.info(`Processing workspace: ${folder.name}`)

                try {
                    const sourceFiles = await this.getCodeSourceFiles(folderPath)
                    workspaceSourceFiles.push(...sourceFiles)
                } catch (error) {
                    this.log.error(`Error processing ${folder.name}: ${error}`)
                }
            }
        }
        this.log.info(`Found ${workspaceSourceFiles.length} source files`)
        return workspaceSourceFiles
    }

    private async getCodeSourceFiles(dir: string): Promise<string[]> {
        try {
            const files = await fs.readdir(dir, { withFileTypes: true })
            const sourceFiles: string[] = []

            for (const file of files) {
                const filePath = path.join(dir, file.name)
                if (file.isDirectory()) {
                    sourceFiles.push(...(await this.getCodeSourceFiles(filePath)))
                } else if (this.fileExtensions.includes(path.extname(file.name).toLowerCase())) {
                    sourceFiles.push(filePath)
                }
            }
            return sourceFiles
        } catch (error) {
            this.log.error(`Error reading directory ${dir}: ${error}`)
            return []
        }
    }

    private findCommonWorkspaceRoot(workspaceFolders: WorkspaceFolder[]): string {
        if (!workspaceFolders.length) {
            throw new Error('No workspace folders provided')
        }
        if (workspaceFolders.length === 1) {
            return new URL(workspaceFolders[0].uri).pathname
        }

        const paths = workspaceFolders.map(folder => new URL(folder.uri).pathname)
        const splitPaths = paths.map(p => p.split(path.sep).filter(Boolean))
        const minLength = Math.min(...splitPaths.map(p => p.length))

        let lastMatchingIndex = -1
        for (let i = 0; i < minLength; i++) {
            const segment = splitPaths[0][i]
            if (splitPaths.every(p => p[i] === segment)) {
                lastMatchingIndex = i
            } else {
                break
            }
        }

        if (lastMatchingIndex === -1) {
            return new URL(workspaceFolders[0].uri).pathname
        }
        return path.sep + splitPaths[0].slice(0, lastMatchingIndex + 1).join(path.sep)
    }
}
