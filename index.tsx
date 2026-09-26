/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { managedStyleRootNode } from "@api/Styles";
import { createAndAppendStyle } from "@utils/css";
import { Logger } from "@utils/Logger";
import { sleep } from "@utils/misc";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { FluxDispatcher, Menu, MessageActions, MessageStore, RestAPI, SelectedChannelStore, UserStore } from "@webpack/common";

const Native = VencordNative.pluginHelpers.EphemeralChat as PluginNative<typeof import("./native")>;
const logger = new Logger("EphemeralChat");

interface SavedMessage {
    /** raw message object as received from the gateway */
    message: any;
    deleteAt: number;
    deleted: boolean;
}

const DELETE_SPACING = 1000;

let saved: Record<string, SavedMessage> = {};
let loaded: Promise<void> = Promise.resolve();
let writing: Promise<void> = Promise.resolve();
let style: HTMLStyleElement | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let deleting = false;
/** ids the plugin is currently deleting, to tell them apart from manual deletes */
const pluginDeleting = new Set<string>();

const settings = definePluginSettings({
    duration: {
        type: OptionType.SLIDER,
        description: "Délai avant suppression des messages, en minutes (1 min à 6 h)",
        markers: [1, 30, 60, 120, 180, 240, 300, 360],
        default: 10,
        stickToMarkers: false
    },
    showSaved: {
        type: OptionType.BOOLEAN,
        description: "Afficher les messages éphémères supprimés (en bleu)",
        default: false,
        onChange: reloadCurrentChannel
    },
    channels: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>
    }
});

function reloadCurrentChannel() {
    const channelId = SelectedChannelStore.getChannelId();
    // a plain fetch resets the channel's message cache, so ghosts get injected / dropped by the interceptor
    if (channelId) MessageActions.fetchMessages({ channelId, limit: 50 });
}

function persist() {
    const data = JSON.stringify(saved);
    writing = writing
        .then(() => Native.save(data))
        .catch(e => logger.error("Failed to save", e));
    updateStyle();
}

function updateStyle() {
    if (!style) return;

    const selectors = Object.values(saved)
        .filter(s => s.deleted)
        .map(({ message: m }) => `#chat-messages-${m.channel_id}-${m.id}`)
        .join(",");

    style.textContent = selectors && `
        :is(${selectors}) {
            --text-default: #4aa8ff;
            --interactive-icon-default: #4aa8ff;
            --text-muted: #4aa8ff;
            --embed-title: #2f7fd6;
            --text-link: #2f7fd6;
            --text-strong: #2f7fd6;
            background-color: rgb(74 168 255 / 8%);
        }
        :is(${selectors}) [class*="buttons"] {
            display: none;
        }
    `;
}

function markDeleted(id: string) {
    const s = saved[id];
    if (!s || s.deleted) return;
    s.deleted = true;
    persist();
}

function forget(id: string) {
    if (!saved[id]) return;
    delete saved[id];
    persist();
}

async function deleteDueMessages() {
    if (deleting) return;
    deleting = true;
    try {
        for (const s of Object.values(saved)) {
            if (!timer) break; // plugin was stopped while we were sleeping

            const { id, channel_id } = s.message;
            // the loop sleeps, so the record may have been deleted by hand meanwhile
            if (!saved[id] || s.deleted || s.deleteAt > Date.now()) continue;

            pluginDeleting.add(id);
            try {
                await RestAPI.del({ url: `/channels/${channel_id}/messages/${id}` });
                markDeleted(id);
            } catch (e: any) {
                // already gone = deleted by hand (e.g. from another device), not by us
                if (e?.status === 404) forget(id);
                else if (e?.status === 429) {
                    // rate limited: wait what Discord asks, this message is retried next tick
                    const retryAfter = e.body?.retry_after ?? 5;
                    logger.warn(`Rate limited, waiting ${retryAfter}s`);
                    await sleep(retryAfter * 1000);
                }
                // ponytail: any other error is retried on the next tick, forever
                else logger.error(`Failed to delete ${id}`, e);
            } finally {
                pluginDeleting.delete(id);
            }

            // space out deletions so a backlog (e.g. after Discord was closed) doesn't burst
            await sleep(DELETE_SPACING);
        }
    } finally {
        deleting = false;
    }
}

function injectGhosts(action: any) {
    const { channelId, messages, isBefore, isAfter, hasMoreBefore, hasMoreAfter } = action;
    const cached = MessageStore.getMessages(channelId)?._array ?? [];
    const toBig = (id?: string) => id == null ? null : BigInt(id);

    // messages from the API are newest first, the cache is oldest first.
    // only inject ghosts that fall inside the range this load covers
    const low = toBig(isAfter ? cached.at(-1)?.id : hasMoreBefore ? messages.at(-1)?.id : undefined);
    const high = toBig(isBefore ? cached[0]?.id : hasMoreAfter ? messages[0]?.id : undefined);
    const present = new Set(messages.map((m: any) => m.id));

    const ghosts = Object.values(saved)
        .filter(({ deleted, message: m }) => {
            if (!deleted || m.channel_id !== channelId || present.has(m.id)) return false;
            const id = BigInt(m.id);
            return (low == null || id > low) && (high == null || id < high);
        })
        .map(s => s.message);

    if (!ghosts.length) return;

    action.messages = [...messages, ...ghosts].sort((a, b) => BigInt(b.id) > BigInt(a.id) ? 1 : -1);
}

function interceptor(action: any) {
    try {
        if (action.type === "MESSAGE_DELETE" && saved[action.id]) {
            // the gateway event can arrive before or after our REST call resolves
            if (!pluginDeleting.has(action.id) && !saved[action.id].deleted) {
                // deleted by hand: drop it from the log and let Discord remove it normally
                forget(action.id);
                return false;
            }

            markDeleted(action.id);
            // returning true swallows the event, so the message stays in chat and turns blue
            return settings.store.showSaved;
        }

        if (action.type === "LOAD_MESSAGES_SUCCESS" && settings.store.showSaved)
            injectGhosts(action);
    } catch (e) {
        logger.error("Interceptor error", e);
    }
    return false;
}

const patchContextMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    const { channels, showSaved } = settings.use(["channels", "showSaved"]);
    if (!channel?.isPrivate()) return;

    const enabled = !!channels[channel.id];

    children.push(
        <Menu.MenuGroup>
            <Menu.MenuCheckboxItem
                id="vc-ephemeral-chat"
                label="Chat éphémère"
                checked={enabled}
                action={() => {
                    const { [channel.id]: _, ...rest } = settings.store.channels;
                    settings.store.channels = enabled ? rest : { ...rest, [channel.id]: true };
                }}
            />
            <Menu.MenuCheckboxItem
                id="vc-ephemeral-chat-show"
                label="Voir les messages éphémères"
                checked={showSaved}
                action={() => settings.store.showSaved = !showSaved}
            />
        </Menu.MenuGroup>
    );
};

export default definePlugin({
    name: "EphemeralChat",
    description: "Supprime tes messages d'un MP après un délai configurable, tout en les sauvegardant dans un fichier pour pouvoir les revoir (en bleu).",
    authors: [{ name: "LilNesquuik", id: 542790005219655687n }],
    settings,

    contextMenus: {
        "user-context": patchContextMenu,
        "gdm-context": patchContextMenu
    },

    flux: {
        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            if (optimistic || !settings.store.channels[message.channel_id]) return;
            if (message.author?.id !== UserStore.getCurrentUser()?.id) return;

            loaded.then(() => {
                saved[message.id] = { message, deleteAt: Date.now() + Math.round(settings.store.duration) * 60_000, deleted: false };
                persist();
            });
        },

        MESSAGE_UPDATE({ message }: { message: any; }) {
            const s = saved[message.id];
            if (!s || s.deleted) return;

            // keep the saved copy in sync with edits
            s.message = { ...s.message, ...message };
            persist();
        }
    },

    start() {
        style = createAndAppendStyle("vc-ephemeral-chat", managedStyleRootNode);

        loaded = Native.load().then(data => {
            try {
                saved = data ? JSON.parse(data) : {};
            } catch (e) {
                // don't overwrite a file we couldn't read
                logger.error("EphemeralChat.json is corrupted, not loading it", e);
                throw e;
            }
            updateStyle();
            timer = setInterval(deleteDueMessages, 15_000);
            deleteDueMessages();
        });

        FluxDispatcher.addInterceptor(interceptor);
    },

    stop() {
        clearInterval(timer);
        timer = undefined;
        style?.remove();
        style = undefined;
        FluxDispatcher._interceptors = FluxDispatcher._interceptors.filter((i: any) => i !== interceptor);
    }
});
