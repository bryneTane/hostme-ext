"use strict";

import { Memento } from "vscode";

export class LocalStorageService {
  constructor(private storage: Memento) {}

  public getValue(key: string): string | undefined {
    return this.storage.get(key);
  }

  public setValue(key: string, value: string) {
    this.storage.update(key, value);
  }
}
