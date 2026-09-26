/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { join } from "path";

const FILE = join(DATA_DIR, "EphemeralChat.json");

export async function load() {
    try {
        return await readFile(FILE, "utf8");
    } catch {
        return null;
    }
}

export async function save(_, data: string) {
    await mkdir(DATA_DIR, { recursive: true });
    // write to a temp file then rename so a crash mid-write never corrupts the log
    await writeFile(FILE + ".tmp", data);
    await rename(FILE + ".tmp", FILE);
}
