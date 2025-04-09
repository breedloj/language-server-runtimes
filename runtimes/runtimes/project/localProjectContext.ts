import { Connection } from 'vscode-languageserver/node'
import { Encoding } from '../encoding'
import { Logging } from '../../server-interface/logging'
import { LspServer } from '../lsp/router/lspServer'
import {
    InitializeParams,
    InitializeResult,
    QueryInlineProjectContextParams,
    QueryVectorIndexParams,
} from '../../protocol'
import { LocalProjectContextController } from './localProjectContextController'
import { TextDocumentConnection } from 'vscode-languageserver/lib/common/textDocuments'

let controller: LocalProjectContextController

export class LocalProjectContext {
    private lspServer: LspServer

    constructor(
        lspConnection: Connection,
        encoding: Encoding,
        logging: Logging,
        textDocumentConnection: TextDocumentConnection
    ) {
        this.lspServer = new LspServer(lspConnection, encoding, logging)

        this.lspServer.setInitializeHandler(async (params: InitializeParams): Promise<InitializeResult> => {
            controller = new LocalProjectContextController(
                params.clientInfo?.name ?? 'unknown',
                params.workspaceFolders ?? [],
                logging
            )
            return {
                capabilities: {},
                awsServerCapabilities: {},
            }
        })

        this.lspServer.setInitializedHandler(async () => {
            try {
                await controller.init()
                logging.log('Local context service has been initialized')
            } catch (error) {
                logging.error(`Failed to initialize local context service: ${error}`)
            }
        })

        this.lspServer.setUpdateConfigurationHandler(async () => {
            try {
                await controller.updateConfiguration()
            } catch (error) {
                logging.error(`Failed to update configuration: ${error}`)
            }
        })

        textDocumentConnection.onDidSaveTextDocument(async event => {
            try {
                const filePaths = [event.textDocument.uri.replace('file:', '')]
                await controller.updateIndex(filePaths, 'update')

                logging.log(`Files saved: ${JSON.stringify(event)}`)
            } catch (error) {
                logging.error(`Error handling save event: ${error}`)
            }
        })

        lspConnection.workspace.onDidCreateFiles(async event => {
            try {
                const filePaths = event.files.map(file => file.uri.replace('file:', ''))
                await controller.updateIndex(filePaths, 'add')

                logging.log(`Files added: ${JSON.stringify(event)}`)
            } catch (error) {
                logging.error(`Error handling create event: ${error}`)
            }
        })

        lspConnection.workspace.onDidDeleteFiles(async event => {
            try {
                const filePaths = event.files.map(file => file.uri.replace('file:', ''))
                await controller.updateIndex(filePaths, 'remove')

                logging.log(`Files deleted: ${JSON.stringify(event)}`)
            } catch (error) {
                logging.error(`Error handling delete event: ${error}`)
            }
        })

        lspConnection.workspace.onDidRenameFiles(async event => {
            try {
                const oldPaths = event.files.map(file => file.oldUri.replace('file:', ''))
                const newPaths = event.files.map(file => file.oldUri.replace('file:', ''))

                await controller.updateIndex(oldPaths, 'remove')
                await controller.updateIndex(newPaths, 'add')

                logging.log(`Files renamed: ${JSON.stringify(event)}`)
            } catch (error) {
                logging.error(`Error handling rename event: ${error}`)
            }
        })
    }

    public getLspServer() {
        return this.lspServer
    }

    public async queryVectorIndex(params: QueryVectorIndexParams) {
        return controller.queryVectorIndex(params)
    }

    public async queryInlineProjectContext(params: QueryInlineProjectContextParams) {
        return controller.queryInlineProjectContext(params)
    }
}
