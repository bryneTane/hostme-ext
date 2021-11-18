import * as vscode from "vscode";
import { LocalStorageService } from "./localStorageService";
import * as fs from "fs";
import * as archiver from "archiver";
import * as FormData from "form-data";
import axios, { AxiosRequestConfig } from "axios";

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand(
    "hostme-ext.hostme-deploy",
    async () => {
      let storageManager = new LocalStorageService(context.workspaceState);

      const bearer = storageManager.getValue("hostme-bearer");

      if (!bearer) {
        const bearerInput = await vscode.window.showInputBox({
          title: "Please, provide your Hostme bearer token",
        });
        if (bearerInput) {
          storageManager.setValue("hostme-bearer", bearerInput);
        } else {
          vscode.window.showInformationMessage("Invalid Bearer token");
          return;
        }
      }

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
        var output = fs.createWriteStream(`${input}.zip`);
        var archive = archiver("zip", {
          zlib: { level: 9 }, // Sets the compression level.
        });

        vscode.window.showInformationMessage("Zipped");

        output.on("close", function () {
          console.log(archive.pointer() + " total bytes");
          console.log(
            "archiver has been finalized and the output file descriptor has closed."
          );

          vscode.window.showInformationMessage("before stream");

          var newFile = fs.createReadStream(`${input}.zip`);

          vscode.window.showInformationMessage("Stream");

          // personally I'd function out the inner body here and just call
          // to the function and pass in the newFile
          newFile.on("end", async () => {
            const formData = new FormData();
            formData.append("file", newFile, `${input}.zip`);
            const requestConfig: AxiosRequestConfig = {
              method: "post",
              url: `https://hostme.space/api/github/${input}/deploy_on_push`,
              headers: {
                // eslint-disable-next-line @typescript-eslint/naming-convention
                Authorization: "Bearer " + bearer,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                Accept: "application/json",
                // eslint-disable-next-line @typescript-eslint/naming-convention
                "Content-Type": "multipart/form-data",
              },
              data: formData,
            };
            try {
              await axios(requestConfig);
              vscode.window.showInformationMessage("Sent");
            } catch (e: any) {
              vscode.window.showInformationMessage("Error");
              if (e.response.status === 401) {
                const bearerInput = await vscode.window.showInputBox({
                  title:
                    "An error occured ! Please, provide your Hostme bearer token !",
                });
                if (bearerInput) {
                  storageManager.setValue("hostme-bearer", bearerInput);
                } else {
                  vscode.window.showInformationMessage("Invalid Bearer token");
                  return;
                }
              }
            }
          });
        });

        archive.on("error", function (err: any) {
          throw err;
        });

        archive.pipe(output);

        archive.directory(fileUri[0].fsPath, false);

        archive.finalize();
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
