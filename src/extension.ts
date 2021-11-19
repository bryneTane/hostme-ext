import * as vscode from "vscode";
import { LocalStorageService } from "./localStorageService";
import * as fs from "fs";
import * as archiver from "archiver";
import * as https from "https";
import * as FormData from "form-data";
import slugify from "slugify";
import axios, { AxiosInterceptorManager, AxiosRequestConfig } from "axios";

let myStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Ajouté à cause d'un pb avec axios et les certificats SSL de Letsencrypt
  https.globalAgent.options.rejectUnauthorized = false

  const commandId = 'hostme-ext.hostme-deploy';

  let disposable = vscode.commands.registerCommand(
    commandId,
    async () => {
      let globalStorageManager = new LocalStorageService(context.globalState);
      let localStorageManager = new LocalStorageService(context.workspaceState);

      const bearer = globalStorageManager.getValue("hostme-bearer");

      if (!bearer) {
        const bearerInput = await vscode.window.showInputBox({
          title: "Please, provide your Hostme API Token (available on https://hostme.space/tokens)",
        });
        if (bearerInput) {
          globalStorageManager.setValue("hostme-bearer", bearerInput);
        } else {
          vscode.window.showInformationMessage("Invalid API Token");
          return;
        }
      }

      let input: string | undefined, default_workspace_name;
      if (vscode.workspace.workspaceFolders !== undefined) {
        console.log(vscode.workspace.workspaceFolders)
        default_workspace_name = slugify(vscode.workspace.workspaceFolders[0].name)

        input = await vscode.window.showInputBox({
          title: "Enter the name of your website",
          value: default_workspace_name
        });

        if (input) {
          globalStorageManager.setValue("hostme-workspace-" + default_workspace_name, input);
        } else {
          vscode.window.showInformationMessage("You have to give a name to deploy your project");
          return;
        }

      } else {
        input = await vscode.window.showInputBox({
          title: "Enter the name of your website",
        });
        if (input) {
          localStorageManager.setValue("hostme-workspace-name", input);
        } else {
          vscode.window.showInformationMessage("You have to give a name to deploy your project");
          return;
        }
      }


      const options: vscode.OpenDialogOptions = {
        canSelectMany: true,
        openLabel: "Deploy this folder",
        canSelectFiles: true,
        canSelectFolders: true,
      };
      if (vscode.workspace.workspaceFolders)
        options.defaultUri = vscode.workspace.workspaceFolders[0].uri;

      const fileUri = await vscode.window.showOpenDialog(options);
      if (fileUri && fileUri[0]) {

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Deployment",
          cancellable: true
        }, (progress, token): any => {

          let axiosDeployRequestSource: any;
          let cancelled = false;
          token.onCancellationRequested(() => {
            cancelled = true;
            console.log("Inside cancellation > ", cancelled)
            if (axiosDeployRequestSource) {
              axiosDeployRequestSource.cancel()
              vscode.window.showInformationMessage("Deploy cancelled ...",)
            }
            console.log("User canceled the long running operation");
            return false;
          });

          progress.report({  increment: 0, message: "Zipping the content ...",  });

          return new Promise((resolve, reject) => {

            var output = fs.createWriteStream(`${input}.zip`);
            var archive = archiver("zip", {
              zlib: { level: 9 }, // Sets the compression level.
            });

            console.log("Outside close. Cancelled ? ", cancelled)
            output.on("close", async function () {
              progress.report({ message: "Sending to Hostme ..." });

              const formData = new FormData();
              const file = await fs.readFileSync(`${input}.zip`);
              formData.append('file', file, `${input}.zip`);
              console.log("Inside close. Cancelled ? ", cancelled)
              if(cancelled){
                reject()
                return; 
              }
              try {
                axiosDeployRequestSource = axios.CancelToken.source()
                let axiosDeployRequest = await axios.post(`https://hostme.space/api/websites/${input}/deploy_on_push`, formData, {
                  headers: {
                    Authorization: "Bearer " + bearer,
                    Accept: "application/json",
                    ...formData.getHeaders()
                  },

                  'maxContentLength': Infinity,
                  'maxBodyLength': Infinity,
                  cancelToken: axiosDeployRequestSource.token,
                  onUploadProgress: (progressEvent) => {
                    // TODO : Je souhaitais faire une barre de progression ici durant l'upload. Mais ca semble ne pas fonctionner. Il faudrait trouver pourquoi
                    console.log(progressEvent)
                    if (progressEvent.lengthComputable) {
                      console.log(progressEvent.loaded + ' ' + progressEvent.total);
                      progress.report({ increment: progressEvent.loaded });
                    }
                  }
                })
                console.log(axiosDeployRequest)
                vscode.window.showInformationMessage("Deployed 🎊. Your website is available on " + input + ".hostme.space",)
                await fs.unlinkSync(`${input}.zip`);
                progress.report({ increment: 100 });
                resolve(axiosDeployRequest)
              } catch (e: any) {
                console.log(e)
                if (e.response.status === 401) {
                  const bearerInput = await vscode.window.showInputBox({
                    title:
                      "An error occured ! Please, provide your Hostme bearer token !",
                  });
                  if (bearerInput) {
                    globalStorageManager.setValue("hostme-bearer", bearerInput);
                  } else {
                    vscode.window.showErrorMessage("Invalid Bearer token");
                    return;
                  }
                } else {
                  vscode.window.showErrorMessage(e.response?.data?.error);
                }
                await fs.unlinkSync(`${input}.zip`);
                reject()
              }

            });

            archive.on("error", function (err: any) {
              console.error(err)
              throw err;
            });

            archive.pipe(output);

            archive.directory(fileUri[0].fsPath, false);

            archive.finalize();

          })
        })

      }
    }
  );

  context.subscriptions.push(disposable);

  myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  myStatusBarItem.command = commandId;
  myStatusBarItem.text = `Deploy on Hostme`;
  myStatusBarItem.show();
  context.subscriptions.push(myStatusBarItem);

}

export function deactivate() { }
