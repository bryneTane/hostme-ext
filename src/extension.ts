import * as vscode from "vscode";
import { LocalStorageService } from "./localStorageService";
import * as fs from "fs";
import * as archiver from "archiver";
import * as https from "https";
import * as FormData from "form-data";
import slugify from "slugify";
import axios from "axios";
import getFolderSize from "get-folder-size";

let myStatusBarItem: vscode.StatusBarItem;

const CLASSIC_DEPLOYMENT = "hostme-ext.hostme-deploy";
const AUTO_DEPLOY = "hostme-ext.hostme-deploy.auto";

/**
 * TODO : Améliorations possibles
 *
 * - Vérifier le slug utilisé pour savoir s'il est bien disponible. Donc faire une requete d'API à Hostme à chaque validation de slug pour vérifier l'existance
 */

/**
 * Deploy to Hostme
 * @param context
 * @param param1
 * @param AUTO_DEPLOY
 * @returns
 */
async function deploy(context: vscode.ExtensionContext, { globalStorageManager, localStorageManager }: { globalStorageManager: LocalStorageService; localStorageManager: LocalStorageService }) {
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

  let input: string | undefined, defaultWorkspaceName;
  if (vscode.workspace.workspaceFolders !== undefined) {
    console.log(vscode.workspace.workspaceFolders);
    defaultWorkspaceName = slugify(vscode.workspace.workspaceFolders[0].name);

    input = await vscode.window.showInputBox({
      title: "Enter the name of your website",
      value: defaultWorkspaceName,
    });

    if (input) {
      globalStorageManager.setValue("hostme-workspace-" + defaultWorkspaceName, input);
    } else {
      vscode.window.showInformationMessage("You have to give a name to deploy your project");
      return;
    }
  } else {
    input = await vscode.window.showInputBox({
      title: "Enter the name of your website",
      value: localStorageManager.getValue("hostme-workspace-name"),
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
  if (vscode.workspace.workspaceFolders) {
    options.defaultUri = vscode.workspace.workspaceFolders[0].uri;
  }

  const fileUri = await vscode.window.showOpenDialog(options);

  if (fileUri && fileUri[0]) {
    try {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Deployment",
          cancellable: true,
        },
        (progress, token): any => {
          let axiosDeployRequestSource: any;
          let cancelled = false;

          token.onCancellationRequested(() => {
            cancelled = true;
            console.log("Inside cancellation > ", cancelled);
            if (axiosDeployRequestSource) {
              axiosDeployRequestSource.cancel();
              vscode.window.showInformationMessage("Deploy cancelled ...");
            }
            console.log("User canceled the long running operation");
            return false;
          });

          progress.report({ increment: 0, message: "Preparing the folder ..." });

          return new Promise(async (resolve, reject) => {
            var output = fs.createWriteStream(`${input}.zip`);
            const pathSize = await getFolderSize.loose(fileUri[0].fsPath);
            if (pathSize > 127000000) {
              // If the folder'size is greather than 128M, cancel the operation. I think it's the server limit for upload file
              vscode.window.showErrorMessage("This folder is too heavy. Select another one", "Choose another folder").then((response) => {
                if (response === "Choose another folder") {
                  vscode.commands.executeCommand(CLASSIC_DEPLOYMENT);
                }
              });

              reject();
              return;
            }
            var archive = archiver("zip", {
              zlib: { level: 9 },
            });

            archive.on("progress", (progressData) => {
              if (cancelled) {
                archive.abort();
              }
              progress.report({ message: "Zipping the content " + progressData.fs.processedBytes + " on " + pathSize + "..." });
            });

            archive.on("error", function (err: any) {
              console.error(err);
              throw err;
            });

            archive.pipe(output);

            archive.directory(fileUri[0].fsPath, false);

            archive.finalize();

            console.log("Outside close. Cancelled ? ", cancelled, pathSize);

            // The ZIP file is ready
            output.on("close", async function () {
              progress.report({ increment: 50, message: "Deploying on Hostme ..." });

              const formData = new FormData();
              const file = await fs.readFileSync(`${input}.zip`);
              formData.append("file", file, `${input}.zip`);
              console.log("Inside close. Cancelled ? ", cancelled);
              if (cancelled) {
                reject();
                return;
              }
              try {
                axiosDeployRequestSource = axios.CancelToken.source();
                let axiosDeployRequest = await axios.post(`https://hostme.space/api/websites/${input}/deploy_on_push`, formData, {
                  headers: {
                    Authorization: "Bearer " + bearer,
                    Accept: "application/json",
                    ...formData.getHeaders(),
                  },

                  maxContentLength: Infinity,
                  maxBodyLength: Infinity,
                  cancelToken: axiosDeployRequestSource.token,
                  onUploadProgress: (progressEvent) => {
                    // TODO : Je souhaitais faire une barre de progression ici durant l'upload. Mais ca semble ne pas fonctionner. Il faudrait trouver pourquoi
                    if (progressEvent.lengthComputable) {
                      console.log(progressEvent.loaded + " " + progressEvent.total);
                      progress.report({ increment: progressEvent.loaded });
                    }
                  },
                });

                console.log(axiosDeployRequest);

                // TODO : Mise à jour possible :  Permettre aux utilisateur de redéployer le meme dossier sans plus avoir à remplir les champs. S'ils souhaitent déployer le meme. Je pensais à ajouter un bouton "Update <slug>.hostme.space" et lorsqu'il cliquera dessus, ca mettra simplement à jour
                // if (vscode.workspace.workspaceFolders !== undefined) {
                //   let defaultWorkspaceName = slugify(vscode.workspace.workspaceFolders[0].name);
                //   if (globalStorageManager.getValue("hostme-workspace-" + defaultWorkspaceName)) {
                //     myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
                //     myStatusBarItem.command = AUTO_DEPLOY;
                //     myStatusBarItem.text = `Deploy to ${globalStorageManager.getValue("hostme-workspace-" + defaultWorkspaceName)}.hostme.space`;
                //     myStatusBarItem.show();
                //     context.subscriptions.push(myStatusBarItem);
                //   }
                // } else {
                //   if (localStorageManager.getValue("hostme-workspace-name")) {
                //     myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
                //     myStatusBarItem.command = AUTO_DEPLOY;
                //     myStatusBarItem.text = `Deploy to ${localStorageManager.getValue("hostme-workspace-name")}.hostme.space`;
                //     myStatusBarItem.show();
                //     context.subscriptions.push(myStatusBarItem);
                //   }
                // }

                vscode.window.showInformationMessage("🎊 Your website is live now, on " + input + ".hostme.space", "Visit").then((action) => {
                  if (action === "Visit") {
                    vscode.env.openExternal(vscode.Uri.parse(`https://${input}.hostme.space`));
                  }
                });
                await fs.unlinkSync(`${input}.zip`);

                resolve(axiosDeployRequest);
              } catch (e: any) {
                console.log(e);
                if (e.response.status === 401) {
                  const bearerInput = await vscode.window.showInputBox({
                    title: "An error occured ! Please, provide your Hostme bearer token !",
                  });
                  if (bearerInput) {
                    globalStorageManager.setValue("hostme-bearer", bearerInput);
                  } else {
                    vscode.window.showErrorMessage("401 Unauthorized. Your API Token seems expired or invalid", "Set a new Token").then((response) => {
                      if (response === "Set a new Token") {
                        vscode.commands.executeCommand(CLASSIC_DEPLOYMENT);
                      }
                    });
                    return;
                  }
                } else {
                  vscode.window.showErrorMessage(e.response?.data?.error, "Try again").then((response) => {
                    if (response === "Try again") {
                      vscode.commands.executeCommand(CLASSIC_DEPLOYMENT);
                    }
                  });
                }
                await fs.unlinkSync(`${input}.zip`);
                reject();
              }
            });
          });
        }
      );
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * TODO : Deploy fastly if we already know the slug
 * @param context
 * @param param1
 * @returns
 */
async function fastDeploy(context: vscode.ExtensionContext, { globalStorageManager, localStorageManager }: { globalStorageManager: LocalStorageService; localStorageManager: LocalStorageService }) {}

export function activate(context: vscode.ExtensionContext) {
  // Ajouté à cause d'un pb avec axios et les certificats SSL de Letsencrypt
  https.globalAgent.options.rejectUnauthorized = false;

  let globalStorageManager = new LocalStorageService(context.globalState);
  let localStorageManager = new LocalStorageService(context.workspaceState);

  let initDeploy = vscode.commands.registerCommand(CLASSIC_DEPLOYMENT, async () => {
    await deploy(context, { globalStorageManager, localStorageManager });
  });
  context.subscriptions.push(initDeploy);

  myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
  myStatusBarItem.command = CLASSIC_DEPLOYMENT;
  myStatusBarItem.text = `Deploy with Hostme`;
  myStatusBarItem.show();
  context.subscriptions.push(myStatusBarItem);

  // let auto_deploy = vscode.commands.registerCommand(AUTO_DEPLOY, async () => {
  //   await fastDeploy(context, { globalStorageManager, localStorageManager });
  // });
  // context.subscriptions.push(auto_deploy);
}

export function deactivate() {}
