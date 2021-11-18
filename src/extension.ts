import * as vscode from "vscode";
import { LocalStorageService } from "./localStorageService";
import * as fs from "fs";
import * as archiver from "archiver";
import * as https from "https";
import * as FormData from "form-data";
import axios, { AxiosRequestConfig } from "axios";
import fetch from "node-fetch";

let myStatusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // Ajouté à cause d'un pb avec axios et les certificats SSL de Letsencrypt
  https.globalAgent.options.rejectUnauthorized = false

  const commandId = 'hostme-ext.hostme-deploy';

  let disposable = vscode.commands.registerCommand(
    commandId,
    async () => {
      let storageManager = new LocalStorageService(context.workspaceState);

      const bearer = storageManager.getValue("hostme-bearer");

      if (!bearer) {
        const bearerInput = await vscode.window.showInputBox({
          title: "Please, provide your Hostme API Token (available on https://hostme.space/tokens)",
        });
        if (bearerInput) {
          storageManager.setValue("hostme-bearer", bearerInput);
        } else {
          vscode.window.showInformationMessage("Invalid API Token");
          return;
        }
      }
      
      // TODO : Pour éviter à l'utilisateur de rentrer plusieurs fois le nom du dossier (s'il souhaite faire une mise à jour par exemple). Je pensais à stocker le nom du projet dans le workspace si possible ou de toujours proposer la derniere valeur qu'il a rempli dans le champ input.

      // let message=""
      // if (vscode.workspace.workspaceFolders !== undefined) {
      //   let wf = vscode.workspace.workspaceFolders[0].uri.path;
      //   let f = vscode.workspace.workspaceFolders[0].uri.fsPath;
      //   console.log(vscode.workspace.workspaceFolders)
      //   message = `YOUR-EXTENSION: folder: ${wf} - ${f}`;

      //   vscode.window.showInformationMessage(message);
      // }
      // else {
      //   message = "YOUR-EXTENSION: Working folder not found, open a folder an try again";

      //   vscode.window.showErrorMessage(message);
      // }

      const input = await vscode.window.showInputBox({
        title: "Enter the name of your website",
      });

      const options: vscode.OpenDialogOptions = {
        canSelectMany: false,
        openLabel: "Open",
        canSelectFiles: false,
        canSelectFolders: true,
      };

      const fileUri = await vscode.window.showOpenDialog(options);
      if (fileUri && fileUri[0]) {

        vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: "Deployment",
          cancellable: true
        }, (progress, token): any => {
          token.onCancellationRequested(() => {
            console.log("User canceled the long running operation");
          });

          progress.report({ increment: 0, message: "Zipping the content ..." });

          return new Promise((resolve, reject) => {

            var output = fs.createWriteStream(`${input}.zip`);
            var archive = archiver("zip", {
              zlib: { level: 9 }, // Sets the compression level.
            });

            output.on("close", async function () {
              progress.report({ message: "Sending to Hostme ..." });

              const formData = new FormData();
              const file = await fs.readFileSync(`${input}.zip`);
              formData.append('file', file, `${input}.zip`);

              try {

                let response = await axios.post(`https://hostme.space/api/websites/${input}/deploy_on_push`, formData, {
                  headers: {
                    Authorization: "Bearer " + bearer,
                    Accept: "application/json",
                    ...formData.getHeaders()
                  },
                  'maxContentLength': Infinity,
                  'maxBodyLength': Infinity,
                  onUploadProgress: (progressEvent) => {
                    // TODO : Je souhaitais faire une barre de progression ici durant l'upload. Mais ca semble ne pas fonctionner. Il faudrait trouver pourquoi
                    console.log(progressEvent)
                    if (progressEvent.lengthComputable) {
                      console.log(progressEvent.loaded + ' ' + progressEvent.total);
                      progress.report({ increment: progressEvent.loaded });
                    }
                  }
                })
                console.log(response)
                vscode.window.showInformationMessage("Deployed 🎊. Your website is available on " + input + ".hostme.space",)
                // TODO !IMPORTANT : Supprimer le fichier créé apres que l'upload soit fait
                resolve(response)
              } catch (e: any) {
                console.log(e)
                if (e.response.status === 401) {
                  const bearerInput = await vscode.window.showInputBox({
                    title:
                      "An error occured ! Please, provide your Hostme bearer token !",
                  });
                  if (bearerInput) {
                    storageManager.setValue("hostme-bearer", bearerInput);
                  } else {
                    vscode.window.showErrorMessage("Invalid Bearer token");
                    return;
                  }
                } else {
                  vscode.window.showErrorMessage(e.response?.data?.error);
                }
                // TODO !IMPORTANT : Supprimer le fichier créé meme s'il ya erreur durant la mise en ligne
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
