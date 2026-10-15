import "./types-BQvjsr62.js";
import { p as progressBus, P as ProgressChannel, L as Logger } from "../index.js";
import { w as writeToFile, r as readFromFile } from "./fileService-C8SUyE3U.js";
import path, { join } from "node:path";
import { satisfies } from "semver";
import { d as determineValidUrl, h as handleLatestValidation, a as determineValidUpdateUrl, b as handleLatestMultiValidation, i as isCacheValid } from "./releaseValidation-ypULtF3d.js";
import { s as storeProvider } from "./storeProvider-DtPF2gpC.js";
import { h as handleError } from "./errorHandler-B9Y6A3HL.js";
import { app } from "electron";
import { writeFile, unlink } from "node:fs/promises";
import { a as ClientPlatformIDs, C as ClientConnectionMethod } from "./clientData-CBo1Cs6M.js";
import EventEmitter from "node:events";
import "./logging-hhDW6hwJ.js";
import "path";
import "electron/main";
import "fs";
import "fs/promises";
import "events";
import "node:process";
import "semver/functions/satisfies.js";
import "node:fs";
import "dotenv";
import "crypto";
import "os";
async function createReleaseFile(type, force = false) {
  if (type === "app") {
    return createAppReleaseFile(force);
  } else {
    return createClientReleaseFile(force);
  }
}
const createClientReleaseFile = async (force = false) => {
  const { clientRepo, defaultClientLatestJSONFallback } = await import("./releaseMetadata-CXAQDd4G.js");
  try {
    const update = progressBus.start(
      ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
      "Creating Client Releases File",
      "Initializing Refresh"
    );
    const githubStore = await storeProvider.getStore("githubStore");
    update(`Fetching latest release from ${clientRepo}`, 20);
    Logger.debug(`Fetching latest release from ${clientRepo}`);
    const latestReleaseAssets = await githubStore.getLatestRelease(clientRepo, force);
    if (!latestReleaseAssets) {
      throw new Error("Unable to find latest release assets");
    }
    update("Searching for latest.json asset", 30);
    const latestReleaseJsonAsset = latestReleaseAssets.assets.find(
      (asset) => asset.name == "latest.json"
    );
    if (!latestReleaseJsonAsset) {
      throw new Error("Unable to find latest.json asset in releases");
    }
    update("Fetching latest.json content", 40);
    const latestJSON = await githubStore.fetchJSONAssetContent(latestReleaseJsonAsset);
    if (!latestJSON) {
      throw new Error("Unable to fetch latest.json");
    }
    const adaptedRelease = await handleReleaseJSONMigration(latestJSON);
    if (adaptedRelease.meta_type == "app")
      throw new Error(`Received meta type 'app' when expecting Multi or Client`);
    if (adaptedRelease.meta_type == "multi") {
      const result = await convertMultiToReleaseServer(adaptedRelease);
      if (result.type == "converted-repos")
        return {
          version: "0.11.11",
          type: "client",
          repositories: result.repos,
          releases: [],
          timestamp: Date.now()
        };
      if (result.type == "converted-apps")
        throw new Error('Received "app" type when expecting multi or client');
      const updatedReleases = await Promise.all(
        result.releases.map((release) => updateLatestServer(release, force))
      );
      const clientReleaseFile = {
        version: "0.11.11",
        type: "client",
        repositories: result.repos,
        releases: updatedReleases,
        timestamp: Date.now()
      };
      return clientReleaseFile;
    }
    const latestServer = {
      id: adaptedRelease.clientManifest.id,
      type: "client",
      mainRelease: adaptedRelease,
      lastUpdated: Date.now(),
      totalDownloads: 0,
      pastReleases: []
    };
    const finalClientReleaseFile = {
      version: "0.11.11",
      type: "client",
      repositories: adaptedRelease.repository ? [latestJSON.repository] : [clientRepo],
      releases: [latestServer],
      timestamp: Date.now()
    };
    progressBus.complete(
      ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
      "Finished creating client release file"
    );
    return finalClientReleaseFile;
  } catch (error) {
    progressBus.error(
      ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
      "Unable to create client release file",
      handleError(error)
    );
    return defaultClientLatestJSONFallback;
  }
};
const createAppReleaseFile = async (force = false) => {
  const { appsRepo, defaultAppLatestJSONFallback } = await import("./releaseMetadata-CXAQDd4G.js");
  try {
    const update = progressBus.start(
      ProgressChannel.FN_RELEASE_APP_REFRESH,
      "Creating App Releases File",
      "Initializing Refresh"
    );
    const githubStore = await storeProvider.getStore("githubStore");
    update(`Fetching latest release from ${appsRepo}`, 20);
    Logger.debug(`Fetching latest release from ${appsRepo}`);
    const latestReleaseAssets = await githubStore.getLatestRelease(appsRepo, force);
    if (!latestReleaseAssets) {
      throw new Error("Unable to find latest release assets");
    }
    update("Searching for latest.json asset", 30);
    const latestReleaseJsonAsset = latestReleaseAssets.assets.find(
      (asset) => asset.name == "latest.json"
    );
    if (!latestReleaseJsonAsset) {
      throw new Error("Unable to find latest.json asset in releases");
    }
    update("Fetching latest.json content", 40);
    const latestJSON = await githubStore.fetchJSONAssetContent(latestReleaseJsonAsset);
    if (!latestJSON) {
      throw new Error("Unable to fetch latest.json");
    }
    update("Validating latest.json content", 50);
    const adaptedRelease = await handleReleaseJSONMigration(latestJSON);
    if (adaptedRelease.meta_type == "client")
      throw new Error(`Received meta type 'client' when expecting Multi or App`);
    if (adaptedRelease.meta_type == "multi") {
      update("Converting multi-release to release server format", 60);
      const result = await convertMultiToReleaseServer(adaptedRelease);
      if (result.type == "converted-repos") {
        update("Creating empty release file", 100);
        return {
          version: "0.11.11",
          type: "app",
          repositories: result.repos,
          releases: [],
          timestamp: Date.now()
        };
      }
      if (result.type == "converted-clients")
        throw new Error('Received "client" type when expecting multi or client');
      update("Creating app release file from multi-release", 90);
      const updatedReleases = await Promise.all(
        result.releases.map((release) => updateLatestServer(release, force))
      );
      const appReleaseFile = {
        version: "0.11.11",
        type: "app",
        repositories: result.repos,
        releases: updatedReleases,
        timestamp: Date.now()
      };
      update("Finalizing app release file", 100);
      return appReleaseFile;
    }
    update("Creating app server configuration", 70);
    const latestServer = {
      id: adaptedRelease.appManifest.id,
      type: "app",
      mainRelease: adaptedRelease,
      lastUpdated: Date.now(),
      totalDownloads: 0,
      pastReleases: []
    };
    update("Finalizing app release file", 90);
    const finalAppReleaseFile = {
      version: "0.11.11",
      type: "app",
      repositories: adaptedRelease.repository ? [latestJSON.repository] : [],
      releases: [latestServer],
      timestamp: Date.now()
    };
    progressBus.complete(
      ProgressChannel.FN_RELEASE_APP_REFRESH,
      "Successfully created app release file"
    );
    return finalAppReleaseFile;
  } catch (error) {
    progressBus.error(
      ProgressChannel.FN_RELEASE_APP_REFRESH,
      "Unable to create app release file",
      handleError(error)
    );
    return defaultAppLatestJSONFallback;
  }
};
const addRepositoryUrl = async (repoUrl, appId) => {
  try {
    const updateProgress = progressBus.start(
      ProgressChannel.FN_RELEASE_ADD_REPO,
      `Adding Repository${appId ? ` for ${appId}` : ""}`,
      `Adding ${repoUrl}`
    );
    const validatedUrl = await determineValidUrl([repoUrl]);
    const githubStore = await storeProvider.getStore("githubStore");
    updateProgress(`Getting GitHub Releases for ${repoUrl}`, 10);
    const githubReleases = await githubStore.getAllReleases(validatedUrl);
    const latestJson = findFirstJsonAsset(githubReleases, appId || "latest");
    const firstZipAsset = findFirstZipAsset(githubReleases, appId || "latest");
    if (!latestJson) {
      updateProgress(`Release JSON not found! Attemting to migrate`, 75);
      const releaseServer = await handleAddingLegacyRepo(validatedUrl, appId);
      progressBus.complete(
        ProgressChannel.FN_RELEASE_ADD_REPO,
        `Found ${releaseServer.id} in releases`
      );
      return releaseServer;
    }
    updateProgress(`Found ${latestJson.label} in releases`, 50);
    updateProgress("Fetching JSON content", 60);
    const jsonContent = await githubStore.fetchJSONAssetContent(latestJson);
    if (!jsonContent) {
      throw new Error("Unable to fetch JSON content from release asset");
    }
    updateProgress("Migrating and validating JSON content", 70);
    const migratedRelease = await handleReleaseJSONMigration(jsonContent, void 0, appId);
    updateProgress("Processing migrated release", 80);
    if (migratedRelease.meta_type === "multi") {
      updateProgress("Converting multi-release to server format", 85);
      const conversionResult = await convertMultiToReleaseServer(migratedRelease);
      progressBus.complete(
        ProgressChannel.FN_RELEASE_ADD_REPO,
        `Successfully processed multi-release with ${conversionResult.releases.length} items`
      );
      return conversionResult;
    }
    if (migratedRelease.meta_type === "app") {
      updateProgress("Creating app server configuration", 85);
      const pastReleases = collectPastReleases(githubReleases, migratedRelease.appManifest.id);
      const totalDownloads = pastReleases.reduce((sum, release) => sum + release.downloads, 0);
      if (firstZipAsset) {
        migratedRelease.downloads = firstZipAsset.download_count;
      }
      const appServer = {
        id: migratedRelease.appManifest.id,
        type: "app",
        mainRelease: migratedRelease,
        lastUpdated: Date.now(),
        totalDownloads,
        pastReleases
      };
      progressBus.complete(
        ProgressChannel.FN_RELEASE_ADD_REPO,
        `Successfully added app: ${appServer.id}`
      );
      return appServer;
    }
    if (migratedRelease.meta_type === "client") {
      updateProgress("Creating client server configuration", 85);
      const pastReleases = collectPastReleases(githubReleases, migratedRelease.clientManifest.id);
      const totalDownloads = pastReleases.reduce((sum, release) => sum + release.downloads, 0);
      if (firstZipAsset) {
        migratedRelease.downloads = firstZipAsset.download_count;
      }
      const clientServer = {
        id: migratedRelease.clientManifest.id,
        type: "client",
        mainRelease: migratedRelease,
        lastUpdated: Date.now(),
        totalDownloads,
        pastReleases
      };
      progressBus.complete(
        ProgressChannel.FN_RELEASE_ADD_REPO,
        `Successfully added client: ${clientServer.id}`
      );
      return clientServer;
    }
    throw new Error(`Unsupported meta_type: ${migratedRelease.meta_type}`);
  } catch (error) {
    progressBus.error(
      ProgressChannel.FN_RELEASE_ADD_REPO,
      "Unable to add repository",
      handleError(error)
    );
    throw error;
  }
};
async function handleRefreshReleaseFile(type, prevReleaseFile, { force = false }) {
  try {
    const update = progressBus.start(
      type == "app" ? ProgressChannel.FN_RELEASE_APP_REFRESH : ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
      "Refreshing Release File",
      "Starting..."
    );
    if (type == "app") {
      const releaseFile = await assertReleaseFileMigration(prevReleaseFile);
      update(`Updating ${releaseFile.releases.length} ${type} releases`, 50);
      const incAmnt = 50 / releaseFile.releases.length;
      let currentProgress = 25;
      const migratedReleases = await Promise.all(
        releaseFile.releases.map(async (release) => {
          update(`Updating ${release.id}`);
          const res = await updateLatestServer(release, force);
          currentProgress += incAmnt;
          update(`Updated ${release.id}`, currentProgress);
          return res;
        })
      );
      const { appsRepo } = await import("./releaseMetadata-CXAQDd4G.js");
      const repositories = releaseFile.repositories || [];
      const updatedAppReleases = [];
      try {
        update(`Fetching the new list of available apps`, 80);
        const githubStore = await storeProvider.getStore("githubStore");
        const allReleases = await githubStore.getAllReleases(appsRepo, force);
        const latestJSONAsset = findFirstJsonAsset(allReleases, "latest");
        const latestJSON = await githubStore.fetchJSONAssetContent(latestJSONAsset);
        update(`Found valid release json`, 80);
        if (!latestJSON || !("repositories" in latestJSON) || !Array.isArray(latestJSON.repositories)) {
          throw new Error("Latest.JSON doesnt have any repositories or was not found");
        }
        const newRepos = latestJSON.repositories.filter((repo) => !repositories.includes(repo));
        if (newRepos.length > 0) {
          repositories.push(...newRepos);
        }
        update(`Found ${repositories.length} apps with ${newRepos.length} new repositories`, 90);
        const existingAppIds = migratedReleases.map((release) => release.id);
        if ("fileIds" in latestJSON && Array.isArray(latestJSON.fileIds) && latestJSON.fileIds.length > 0) {
          const newAppIds = latestJSON.fileIds.filter((id) => !existingAppIds.includes(id));
          if (newAppIds.length > 0) {
            update(`Found ${newAppIds.length} new app IDs`, 93);
            const results = await Promise.allSettled(
              newAppIds.map(
                async (fileId) => convertIdToReleaseServer(fileId, appsRepo, allReleases)
              ) ?? []
            );
            const apps = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
            results.filter((result) => result.status === "rejected").forEach((result, index) => {
              const fileId = newAppIds[index];
              Logger.warn(
                `Unable to convert ${fileId} to a full release using ${appsRepo} because ${handleError(result.reason)}`,
                { function: "refreshReleaseFile", source: "handleRefreshReleaseFile" }
              );
            });
            updatedAppReleases.push(...apps);
          }
        }
      } catch (error) {
        Logger.warn(`Error fetching releases for ${appsRepo}: ${handleError(error)}`);
        update(`Failed to find new repos, reverting and continuing anyways`, 95);
      }
      const finalReleaseFile = {
        version: "0.11.11",
        type: "app",
        repositories: releaseFile.repositories,
        releases: [...updatedAppReleases, ...migratedReleases],
        timestamp: Date.now()
      };
      update("Saving app release file", 100);
      return finalReleaseFile;
    } else {
      const releaseFile = await assertReleaseFileMigration(prevReleaseFile);
      update(`Updating ${releaseFile.releases.length} ${type} releases`, 25);
      const incAmnt = 50 / releaseFile.releases.length;
      let currentProgress = 25;
      const migratedReleases = await Promise.all(
        releaseFile.releases.map(async (release) => {
          try {
            update(`Updating ${release.id}`);
            const res = await updateLatestServer(release, force);
            currentProgress += incAmnt;
            update(`Updated ${release.id}`, currentProgress);
            return res;
          } catch (error) {
            Logger.warn(
              `Failed to update ${release.id} because ${handleError(error)}. Reverting back to old version.`,
              { function: "handleRefreshReleaseFile" }
            );
            update(`Failed to update ${release.id}. Reverting...`, currentProgress);
            return release;
          }
        })
      );
      const { clientRepo } = await import("./releaseMetadata-CXAQDd4G.js");
      const repositories = releaseFile.repositories || [];
      const updatedClientReleases = [];
      try {
        update(`Fetching the new list of available clients`, 80);
        const githubStore = await storeProvider.getStore("githubStore");
        const allReleases = await githubStore.getAllReleases(clientRepo, force);
        const latestJSONAsset = findFirstJsonAsset(allReleases, "latest");
        const latestJSON = await githubStore.fetchJSONAssetContent(latestJSONAsset);
        update(`Found valid release json`, 80);
        if (!latestJSON || !("repositories" in latestJSON) || !Array.isArray(latestJSON.repositories)) {
          throw new Error("Latest.JSON doesnt have any repositories or was not found");
        }
        const newRepos = latestJSON.repositories.filter((repo) => !repositories.includes(repo));
        if (newRepos.length > 0) {
          repositories.push(...newRepos);
        }
        update(`Found ${repositories.length} apps with ${newRepos.length} new repositories`, 90);
        const existingAppIds = migratedReleases.map((release) => release.id);
        if ("fileIds" in latestJSON && Array.isArray(latestJSON.fileIds) && latestJSON.fileIds.length > 0) {
          const newAppIds = latestJSON.fileIds.filter((id) => !existingAppIds.includes(id));
          if (newAppIds.length > 0) {
            update(`Found ${newAppIds.length} new app IDs`, 93);
            const results = await Promise.allSettled(
              newAppIds.map(
                async (fileId) => convertIdToReleaseServer(fileId, clientRepo, allReleases)
              ) ?? []
            );
            const apps = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
            results.filter((result) => result.status === "rejected").forEach((result, index) => {
              const fileId = newAppIds[index];
              Logger.warn(
                `Unable to convert ${fileId} to a full release using ${clientRepo} because ${handleError(result.reason)}`,
                { function: "refreshReleaseFile", source: "handleRefreshReleaseFile" }
              );
            });
            update(`Found ${apps.length} new apps`, 95);
            updatedClientReleases.push(...apps);
          }
        }
      } catch (error) {
        Logger.warn(`Error fetching releases for ${clientRepo}: ${handleError(error)}`);
        update(`Failed to find new repos, reverting and continuing anyways`, 95);
      }
      const finalReleaseFile = {
        version: "0.11.11",
        type: "client",
        repositories,
        releases: [...updatedClientReleases, ...migratedReleases],
        timestamp: Date.now()
      };
      update("Saving client release file", 100);
      return finalReleaseFile;
    }
  } catch (error) {
    Logger.warn(`Unable to migrate ${type} release file because: ${handleError(error)}`, {
      function: "handleRefreshReleaseFile"
    });
    progressBus.error(
      type == "app" ? ProgressChannel.FN_RELEASE_APP_REFRESH : ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
      "Error refreshing release file",
      handleError(error),
      "Error Refreshing!"
    );
    return prevReleaseFile;
  }
}
const updateLatestServer = async (releaseLatest, force = false) => {
  try {
    Logger.debug(`Updating release for ${releaseLatest.id}`, {
      function: "updateReleaseFile"
    });
    const githubStore = await storeProvider.getStore("githubStore");
    const allReleases = await githubStore.getAllReleases(
      releaseLatest.mainRelease.repository,
      force
    );
    const firstReleaseAsset = findFirstJsonAsset(allReleases, releaseLatest.id) || findJsonAsset(allReleases[0], releaseLatest.id, false);
    const releaseJSON = firstReleaseAsset ? await githubStore.fetchJSONAssetContent(firstReleaseAsset) : void 0;
    if (!releaseJSON) {
      Logger.debug(`Handling release for ${releaseLatest.id}`);
      const releaseServer = await handleAddingLegacyRepo(
        releaseLatest.mainRelease.repository,
        releaseLatest.id
      );
      return releaseServer;
    }
    const migratedRelease = await handleReleaseJSONMigration(
      releaseJSON,
      releaseLatest.mainRelease,
      releaseLatest.id
    );
    if (migratedRelease.meta_type == "multi") {
      throw new Error(
        `Error with file! Incoming type '${migratedRelease.meta_type}' does not equal expected '${releaseLatest.type}' type`
      );
    }
    if (migratedRelease.meta_type != releaseLatest.type)
      throw new Error(
        `Type Mismatch! Incoming type '${migratedRelease.meta_type}' does not equal expected '${releaseLatest.type}' type`
      );
    const latestRelease = findFirstZipAsset(allReleases, releaseLatest.id);
    if (latestRelease) {
      Logger.debug(`Updating URL for ${releaseLatest.id} to ${latestRelease.browser_download_url}`);
      migratedRelease.updateUrl = latestRelease.browser_download_url;
    } else {
      Logger.debug(`No release found for ${releaseLatest.id}`);
    }
    const pastReleases = collectPastReleases(allReleases, releaseLatest.id);
    const totalDownloads = pastReleases.reduce((sum, release) => sum + release.downloads, 0);
    migratedRelease.downloads = firstReleaseAsset?.download_count || 0;
    return {
      id: releaseLatest.id,
      type: releaseLatest.type,
      mainRelease: migratedRelease,
      lastUpdated: Date.now(),
      totalDownloads,
      pastReleases
    };
  } catch (error) {
    Logger.warn(
      `Failed to update ${releaseLatest.id} because ${handleError(error)}. Reverting back to old version.`,
      {
        function: "convertMultiToReleaseServer"
      }
    );
    return releaseLatest;
  }
};
const findJsonAsset = (release, appId, strict = false) => {
  const sortedAssets = release.assets.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const appIdJson = sortedAssets.find((asset) => asset.name === `${appId}.json`);
  if (appIdJson) return appIdJson;
  if (strict) return;
  const latestJson = sortedAssets.find((asset) => asset.name === "latest.json");
  return latestJson;
};
const findZipAsset = (release, appId) => {
  const sortedAssets = release.assets.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sortedAssets.find(
    (asset) => asset.name.includes(appId) && (asset.name.endsWith(".zip") || asset.name.endsWith(".tar.gz"))
  );
};
const findAllZipAssets = (release, appId) => {
  const sortedAssets = release.assets.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return sortedAssets.filter(
    (asset) => asset.name.includes(appId) && (asset.name.endsWith(".zip") || asset.name.endsWith(".tar.gz"))
  );
};
const convertMultiToReleaseServer = async (releaseMulti) => {
  const githubStore = await storeProvider.getStore("githubStore");
  const ghReleases = await githubStore.getAllReleases(releaseMulti.repository);
  if (!ghReleases) throw new Error(`Releases at the end of ${releaseMulti.repository} were empty!`);
  if (releaseMulti.fileIds && releaseMulti.fileIds.length > 0) {
    const results = await Promise.allSettled(
      releaseMulti.fileIds?.map(
        async (fileId) => convertIdToReleaseServer(fileId, releaseMulti.repository, ghReleases)
      ) ?? []
    );
    const apps = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    results.filter((result) => result.status === "rejected").forEach((result, index) => {
      const fileId = releaseMulti.fileIds?.[index];
      Logger.warn(
        `Unable to convert ${fileId} to a full release using ${releaseMulti.repository} because ${handleError(result.reason)}`,
        { function: "releaseUtils", source: "convertIdToReleaseServer" }
      );
    });
    const type = apps[0].type;
    return {
      repos: releaseMulti.repositories || [],
      type: `converted-${type}s`,
      releases: apps
    };
  }
  return {
    repos: releaseMulti.repositories || [],
    type: "converted-repos",
    releases: []
  };
};
const findFirstJsonAsset = (ghReleases, appId) => {
  for (const release of ghReleases) {
    const jsonAsset = findJsonAsset(release, appId, true);
    if (jsonAsset) {
      return jsonAsset;
    }
  }
  return void 0;
};
const findFirstZipAsset = (ghReleases, appId) => {
  for (const release of ghReleases) {
    const zipAsset = findZipAsset(release, appId);
    if (zipAsset) {
      return zipAsset;
    }
  }
  return void 0;
};
const convertIdToReleaseServer = async (appId, repository, ghReleases) => {
  const githubStore = await storeProvider.getStore("githubStore");
  if (!ghReleases) {
    ghReleases = await githubStore.getAllReleases(repository);
  }
  if (!ghReleases) throw new Error("No releases found");
  const firstJsonAsset = findFirstJsonAsset(ghReleases, appId);
  const firstZipAsset = findFirstZipAsset(ghReleases, appId);
  let mainRelease;
  if (!firstJsonAsset && ghReleases.length > 0) {
    const latestJson = findJsonAsset(ghReleases[0], appId, false);
    const jsonContent = await githubStore.fetchJSONAssetContent(latestJson);
    if (!jsonContent) throw new Error(`No release found containing app ID: ${appId}`);
    mainRelease = await handleReleaseJSONMigration(jsonContent, void 0, appId);
  } else {
    if (!firstJsonAsset) {
      throw new Error(`No release found containing app ID: ${appId}`);
    }
    const preMainRelease = await githubStore.fetchJSONAssetContent(firstJsonAsset);
    if (!preMainRelease) throw new Error(`No release found containing app ID: ${appId}`);
    mainRelease = await handleReleaseJSONMigration(preMainRelease);
  }
  if (mainRelease.meta_type == "multi") throw new Error("Unable to hande meta_type equaling multi");
  const pastReleases = collectPastReleases(ghReleases, appId);
  const totalDownloads = pastReleases.reduce((sum, release) => sum + release.downloads, 0);
  if (firstZipAsset) mainRelease.downloads = firstZipAsset.download_count;
  if (mainRelease.meta_type === "app") {
    return {
      type: mainRelease.meta_type,
      id: appId,
      mainRelease,
      lastUpdated: Date.now(),
      totalDownloads,
      pastReleases
    };
  } else {
    return {
      type: mainRelease.meta_type,
      id: appId,
      mainRelease,
      lastUpdated: Date.now(),
      totalDownloads,
      pastReleases
    };
  }
};
const collectPastReleases = (ghReleases, fileId) => {
  return ghReleases.flatMap((release) => {
    const zipAssets = findAllZipAssets(release, fileId);
    if (!zipAssets) return [];
    return zipAssets.map((zipAsset) => {
      return {
        tag: release.tag_name,
        downloads: zipAsset.download_count,
        size: zipAsset.size,
        name: zipAsset.name,
        download_url: zipAsset.browser_download_url,
        created_at: release.created_at
      };
    });
  });
};
async function assertReleaseFileMigration(releaseFile) {
  if (releaseFile.version == "0.11.11") {
    return releaseFile;
  }
  if (releaseFile.version == "0.11.8") {
    if (releaseFile.type === "app") {
      return assertReleaseFileMigration0118(releaseFile);
    } else {
      return assertReleaseFileMigration0118(releaseFile);
    }
  }
  if (releaseFile.version == "0.10.0") {
    if ("references" in releaseFile) {
      return assertReleaseFileMigration0108(releaseFile);
    } else {
      return assertReleaseFileMigration0108(releaseFile);
    }
  }
  console.debug(releaseFile);
  throw new Error("Unsupported release file version!");
}
async function assertReleaseFileMigration0118(releaseFile) {
  const allRepositories = [
    ...releaseFile.releases.map(
      (release) => release.mainRelease?.repository
    ),
    ...releaseFile.repositories
  ].filter((repo) => Boolean(repo)).map((repo) => repo.toLowerCase());
  const uniqueRepositories = [...new Set(allRepositories)];
  if (releaseFile.type == "app") {
    const newReleaseFile = await createAppReleaseFile(true);
    newReleaseFile.repositories = uniqueRepositories;
    return newReleaseFile;
  } else {
    const newReleaseFile = await createClientReleaseFile(true);
    newReleaseFile.repositories = uniqueRepositories;
    return newReleaseFile;
  }
}
async function assertReleaseFileMigration0108(releaseFile) {
  const type = "references" in releaseFile ? "app" : "client";
  const validRepositories = [];
  const githubStore = await storeProvider.getStore("githubStore");
  const updatedReleases = await Promise.all(
    releaseFile.releases.map(async (release) => {
      const updatedRelease = await handleReleaseJSONMigration(release);
      if (updatedRelease.meta_type == "multi") {
        if (updatedRelease.repositories) {
          const updatedRepositories = await Promise.all(
            updatedRelease.repositories.map(async (repo) => {
              return await determineValidUrl([repo]);
            })
          );
          validRepositories.push(...updatedRepositories);
        }
        return;
      } else if (updatedRelease.meta_type == "app") {
        let pastReleases = [];
        let totalDownloads = 0;
        try {
          const githubReleases = await githubStore.getAllReleases(updatedRelease.repository);
          const latestRelease = findFirstZipAsset(githubReleases, updatedRelease.appManifest.id);
          if (latestRelease) {
            Logger.debug(
              `Updating URL for ${updatedRelease.appManifest.id} to ${latestRelease.browser_download_url}`
            );
            updatedRelease.updateUrl = latestRelease.browser_download_url;
          } else {
            Logger.debug(`No release found for ${updatedRelease.appManifest.id}`);
          }
          pastReleases = collectPastReleases(githubReleases, updatedRelease.appManifest.id);
          totalDownloads = pastReleases.reduce((acc, release2) => acc + release2.downloads, 0);
        } catch (error) {
          Logger.warn(
            `There was an error collecting past releases for ${updatedRelease.appManifest.id}: ${handleError(error)}`
          );
        }
        const latest = {
          id: updatedRelease.appManifest.id,
          mainRelease: updatedRelease,
          lastUpdated: Date.now(),
          totalDownloads,
          pastReleases
        };
        return latest;
      } else if (updatedRelease.meta_type == "client") {
        let pastReleases = [];
        let totalDownloads = 0;
        try {
          const githubReleases = await githubStore.getAllReleases(updatedRelease.repository);
          const latestRelease = findFirstZipAsset(githubReleases, updatedRelease.clientManifest.id);
          if (latestRelease) {
            updatedRelease.updateUrl = latestRelease.browser_download_url;
          }
          pastReleases = collectPastReleases(githubReleases, updatedRelease.clientManifest.id);
          totalDownloads = pastReleases.reduce((acc, release2) => acc + release2.downloads, 0);
        } catch (error) {
          Logger.warn(
            `There was an error collecting past releases for ${updatedRelease.clientManifest.id}: ${handleError(error)}`
          );
        }
        const latest = {
          id: updatedRelease.clientManifest.id,
          mainRelease: updatedRelease,
          lastUpdated: Date.now(),
          totalDownloads,
          pastReleases
        };
        return latest;
      } else {
        Logger.debug(`Release ${release.id} is not supported`, {
          function: "handleReleaseJSONMigration",
          source: "migrationUtils"
        });
        return;
      }
    })
  );
  const filteredReleases = updatedReleases.filter(
    (release) => release != void 0 && release.type == type
  );
  return {
    type,
    version: "0.11.11",
    repositories: validRepositories,
    releases: filteredReleases,
    timestamp: Date.now()
  };
}
const handleReleaseJSONMigration = async (newRelease, pastRelease, appId) => {
  try {
    if ("meta_version" in newRelease) {
      if (pastRelease && newRelease.meta_type != pastRelease?.meta_type)
        throw new Error("meta_type does not match pastReleases");
      if (satisfies(newRelease.meta_version, "=0.11.8")) return newRelease;
      if (satisfies(newRelease.meta_version, ">=0.11.8")) {
        Logger.warn(
          `Release ${newRelease.meta_type} is from the future and will be attempted to be migrated to the current version: ${newRelease.meta_version}`
        );
      }
      const sanitizedRelease = await handleLatestValidation(newRelease, pastRelease);
      return sanitizedRelease;
    }
    if ("type" in newRelease) {
      switch (newRelease.type) {
        case "external":
          return await handleReleaseExternalToMultiJSONMigration(
            newRelease,
            pastRelease?.meta_type == "multi" ? pastRelease : void 0
          );
        case "multi":
          if (appId) {
            return await handleReleaseMultiToAppJSONMigration(
              newRelease,
              pastRelease?.meta_type == "multi" || pastRelease?.meta_type == "app" ? pastRelease : void 0,
              appId
            );
          } else {
            return await handleReleaseMultiToAppMultiMigration(
              newRelease,
              pastRelease?.meta_type == "multi" ? pastRelease : void 0
            );
          }
        case "single":
          return await handleReleaseMetaToAppJSONMigration(
            newRelease,
            pastRelease?.meta_type == "app" ? pastRelease : void 0
          );
      }
    } else {
      return await handleReleaseMetaClientToClientJSONMigration(
        newRelease,
        pastRelease?.meta_type == "client" ? pastRelease : void 0
      );
    }
  } catch (error) {
    if (pastRelease) {
      Logger.error(
        `Failed to migrate release ${pastRelease?.meta_type || "unknown"} because ${handleError(error)}`,
        {
          function: "handleReleaseMetaToAppJSONMigration",
          source: "migrationUtils"
        }
      );
      return pastRelease;
    } else {
      try {
        Logger.debug(
          `Failed to migrate release ${handleError(error)} ${JSON.stringify(newRelease)}`,
          {
            function: "handleReleaseMetaToAppJSONMigration",
            source: "migrationUtils"
          }
        );
        throw error;
      } catch {
        throw error;
      }
    }
  }
};
const handleReleaseMetaToAppJSONMigration = async (releaseMeta, pastRelease) => {
  if ("meta_version" in releaseMeta) {
    if (releaseMeta.meta_type !== "app") {
      throw new Error(`Invalid meta_type: ${releaseMeta.meta_type}! It's not 'app'`);
    }
    if (releaseMeta.meta_version === "0.11.8") {
      return { ...pastRelease, ...releaseMeta };
    }
    return { ...pastRelease, ...releaseMeta };
  }
  if (releaseMeta.type === "single") {
    const appId = releaseMeta.id || pastRelease?.appManifest?.id || "";
    const validatedRepository = await determineValidUrl([
      releaseMeta.repository,
      pastRelease?.repository || ""
    ]);
    const validatedUpdateUrl = await determineValidUpdateUrl(
      [
        releaseMeta.updateUrl,
        pastRelease?.updateUrl || "",
        releaseMeta.repository,
        pastRelease?.repository || ""
      ],
      appId
    );
    let downloads = releaseMeta.downloads || pastRelease?.downloads || 0;
    let size = releaseMeta.size || pastRelease?.size || 0;
    try {
      const githubStore = await storeProvider.getStore("githubStore");
      const releaseData = await githubStore.getLatestRelease(validatedRepository);
      if (releaseData) {
        const appAsset = releaseData.assets.find(
          (asset) => asset.name.includes(appId) && (asset.name.endsWith(".zip") || asset.name.endsWith(".tar.gz"))
        );
        if (appAsset) {
          downloads = appAsset.download_count || downloads;
          size = appAsset.size || size;
        }
      }
    } catch (error) {
      Logger.warn(`Failed to fetch latest stats for ${appId}: ${handleError(error)}`);
    }
    return {
      meta_version: "0.11.8",
      meta_type: "app",
      appManifest: {
        ...pastRelease?.appManifest,
        id: appId,
        version: releaseMeta.version,
        requires: pastRelease?.appManifest?.requires || [],
        tags: releaseMeta.tags || pastRelease?.appManifest?.tags || [],
        requiredVersions: releaseMeta.requiredVersions || pastRelease?.appManifest?.requiredVersions,
        author: releaseMeta.author,
        description: releaseMeta.description,
        label: releaseMeta.label
      },
      repository: validatedRepository,
      updateUrl: validatedUpdateUrl,
      size,
      createdAt: releaseMeta.createdAt || pastRelease?.createdAt || 0,
      updatedAt: releaseMeta.updatedAt || pastRelease?.updatedAt || Date.now(),
      downloads,
      icon: releaseMeta.icon || pastRelease?.icon,
      hash: releaseMeta.hash,
      hashAlgorithm: releaseMeta.hashAlgorithm
    };
  }
  throw new Error(`Unable to update app of type ${releaseMeta.type}!`);
};
const handleReleaseExternalToMultiJSONMigration = async (releaseMeta, pastRelease) => {
  if ("meta_version" in releaseMeta) {
    if (satisfies(releaseMeta.meta_version, "=0.11.8")) {
      return releaseMeta;
    } else {
      Logger.warn(`Unable to handle translation between ${releaseMeta.meta_version} and 0.11.8`);
      return { ...pastRelease, ...releaseMeta };
    }
  }
  throw new Error("Not implemented yet!");
};
const handleReleaseMultiToAppJSONMigration = async (releaseMeta, pastRelease, appId) => {
  const githubStore = await storeProvider.getStore("githubStore");
  if ("meta_version" in releaseMeta) {
    const validatedRepoUrl2 = await determineValidUrl([
      releaseMeta.repository,
      pastRelease?.repository || ""
    ]);
    if (releaseMeta.fileIds) {
      const releases2 = await githubStore.getAllReleases(validatedRepoUrl2);
      const serverReleases = await Promise.all(
        releaseMeta.fileIds.map(async (id) => {
          return convertIdToReleaseServer(id, validatedRepoUrl2, releases2).catch((error) => {
            Logger.error(`Failed to convert ID ${id} to release server: ${handleError(error)}`);
            return void 0;
          });
        })
      );
      const appReleases = serverReleases.filter(
        (release) => release != void 0 && release.type === "app"
      );
      if (appId) {
        const app2 = appReleases.filter((app3) => app3.id === appId)[0];
        return app2.mainRelease;
      } else {
        const apps = appReleases.map((app2) => app2.mainRelease);
        return apps;
      }
    }
    throw new Error("Release Multi didnt have fileIds available.");
  }
  if (releaseMeta.type == "single")
    return await handleReleaseMetaToAppJSONMigration(
      releaseMeta,
      pastRelease?.meta_type == "app" ? pastRelease : void 0
    );
  if (releaseMeta.type == "external") {
    throw new Error(
      `Unable to handle type 'external' when migrating - this is generally a community release`
    );
  }
  const validatedRepoUrl = await determineValidUrl([
    releaseMeta.repository,
    pastRelease?.repository || ""
  ]);
  const releases = await githubStore.getAllReleases(validatedRepoUrl);
  const latestJson = await Promise.all(
    releaseMeta.releases.map(async (release) => {
      const appRelease = findFirstZipAsset(releases, release.id);
      return {
        meta_version: "0.11.8",
        meta_type: "app",
        appManifest: {
          id: release.id,
          name: release.id,
          version: release.version,
          requires: [],
          tags: release.tags || "",
          requiredVersions: release.requiredVersions || "",
          author: release.author || appRelease?.uploader.login || "",
          description: release.description || "",
          homepage: release.homepage || validatedRepoUrl || "",
          repository: validatedRepoUrl || release.repository || "",
          updateUrl: appRelease?.browser_download_url || await determineValidUpdateUrl(
            [
              validatedRepoUrl,
              release.updateUrl,
              release.repository,
              releaseMeta.repository,
              pastRelease?.repository || ""
            ],
            release.id
          )
        },
        icon: release.icon,
        hash: release.hash,
        hashAlgorithm: release.hashAlgorithm,
        repository: validatedRepoUrl || await determineValidUrl([
          release.repository,
          releaseMeta.repository,
          pastRelease?.repository || ""
        ]),
        updateUrl: appRelease?.browser_download_url || await determineValidUpdateUrl(
          [
            release.updateUrl,
            release.repository,
            releaseMeta.repository,
            pastRelease?.repository || ""
          ],
          release.id
        ),
        downloads: appRelease?.download_count || release.downloads || 0,
        size: release.size || appRelease?.size || 0,
        createdAt: appRelease?.created_at ? new Date(appRelease.created_at).getTime() : release.createdAt || 0,
        updatedAt: appRelease?.updated_at ? new Date(appRelease.updated_at).getTime() : release.updatedAt || 0
      };
    })
  );
  if (appId) {
    return latestJson.filter((json) => json.appManifest.id === appId)[0];
  } else {
    return latestJson;
  }
};
const handleReleaseMultiToAppMultiMigration = async (releaseMeta, pastRelease) => {
  if ("meta_version" in releaseMeta) {
    return await handleLatestMultiValidation(releaseMeta, pastRelease);
  }
  if (releaseMeta.type == "single")
    throw new Error("Single type not supported in ReleaseMultitoMultiJson migration!");
  if (releaseMeta.type == "external") {
    throw new Error(
      `Unable to handle type 'external' when migrating - this is generally a community release`
    );
  }
  const latestJson = {
    meta_version: "0.11.8",
    meta_type: "multi",
    fileIds: releaseMeta.releases.map((release) => release.id),
    repository: await determineValidUrl([releaseMeta.repository])
  };
  return latestJson;
};
const handleReleaseMetaClientToClientJSONMigration = async (releaseMeta, pastRelease) => {
  if ("meta_version" in releaseMeta) {
    return releaseMeta;
  }
  const validatedRepository = await determineValidUrl([
    releaseMeta.repository,
    pastRelease?.repository || ""
  ]);
  const validatedUpdateUrl = await determineValidUpdateUrl(
    [
      releaseMeta.updateUrl,
      pastRelease?.updateUrl || "",
      releaseMeta.repository,
      pastRelease?.repository || ""
    ],
    releaseMeta.id
  );
  let downloads = 0;
  let size = releaseMeta.size || 0;
  try {
    const githubStore = await storeProvider.getStore("githubStore");
    const releaseData = await githubStore.getLatestRelease(validatedRepository);
    if (releaseData) {
      const appAsset = releaseData.assets.find(
        (asset) => asset.name.includes(releaseMeta.id) && (asset.name.endsWith(".zip") || asset.name.endsWith(".tar.gz"))
      );
      if (appAsset) {
        downloads = appAsset.download_count || downloads;
        size = appAsset.size || size;
      }
    }
  } catch (error) {
    Logger.warn(`Failed to fetch latest stats for ${releaseMeta.id}: ${handleError(error)}`);
  }
  return {
    meta_version: "0.11.8",
    meta_type: "client",
    clientManifest: {
      ...pastRelease?.clientManifest,
      id: releaseMeta.id,
      name: releaseMeta.id,
      version: releaseMeta.version,
      short_name: releaseMeta.short_name || pastRelease?.clientManifest.short_name || releaseMeta.id,
      description: releaseMeta.description || pastRelease?.clientManifest.description || "",
      reactive: pastRelease?.clientManifest.reactive || false,
      repository: validatedRepository,
      author: releaseMeta.author || pastRelease?.clientManifest.author || "",
      compatibility: pastRelease?.clientManifest.compatibility || {
        server: "0.11.0",
        app: "0.11.8"
      },
      context: {
        id: ClientPlatformIDs.Unknown,
        name: "",
        ip: "",
        port: 0,
        method: ClientConnectionMethod.Unknown
      }
    },
    repository: validatedRepository,
    updateUrl: validatedUpdateUrl,
    size,
    createdAt: releaseMeta.createdAt || pastRelease?.createdAt || 0,
    updatedAt: releaseMeta.updatedAt || pastRelease?.updatedAt || Date.now(),
    downloads,
    icon: releaseMeta.icon || pastRelease?.icon,
    hash: releaseMeta.hash,
    hashAlgorithm: releaseMeta.hashAlgorithm
  };
};
const handleAddingLegacyRepo = async (repoUrl, appId) => {
  const githubStore = await storeProvider.getStore("githubStore");
  const { debug } = Logger.createLogger({
    method: "handleAddingLegacyRepo",
    store: "migrationUtils"
  });
  debug("Fetching all releases");
  const allReleases = await githubStore.getAllReleases(repoUrl);
  debug(`Found ${allReleases.length} releases`);
  const latestRelease = allReleases[0];
  debug(`Found ${latestRelease.assets.length} asset(s) in the latest release`);
  const zipFiles = latestRelease.assets.filter(
    (asset) => asset.content_type.includes("zip") && (!appId || asset.name.toLowerCase().includes(appId.toLowerCase()))
  );
  debug(`Found ${zipFiles.length} zip in the latest release`);
  const appFiles = zipFiles.filter((asset) => asset.name.toLowerCase().includes("-app"));
  const clientFiles = zipFiles.filter((asset) => asset.name.toLowerCase().includes("-client"));
  debug(
    `Found ${appFiles.length} app assets and ${clientFiles.length} client assets in the latest release`
  );
  if (appFiles.length === 0 && clientFiles.length === 0) {
    return reconstructReleaseBasedOnZipAsset(zipFiles[0], repoUrl, appId);
  }
  const appPriority = appFiles.length;
  const clientPriority = clientFiles.length;
  const type = appPriority > clientPriority ? "app" : "client";
  const releaseFile = type === "app" ? appFiles[0] : clientFiles[0];
  debug(`Chose ${releaseFile} ${type} out of ${appPriority} apps and ${clientPriority} clients`);
  const fileId = appId || releaseFile.name.split("-")[0];
  const pastReleases = collectPastReleases(allReleases, fileId);
  const totalDownloads = pastReleases.reduce((acc, release) => acc + release.downloads, 0);
  const latestJSON = {
    repository: repoUrl,
    updateUrl: releaseFile.browser_download_url,
    downloads: releaseFile.download_count,
    size: releaseFile.size,
    updatedAt: new Date(releaseFile.updated_at).getTime(),
    createdAt: new Date(releaseFile.created_at).getTime()
  };
  const releaseServer = {
    id: fileId,
    type,
    lastUpdated: Date.now(),
    totalDownloads,
    pastReleases
  };
  try {
    const releaseManifest = await fetchAndUnzipFileToGetManifest(releaseFile);
    if (type == "app" && "label" in releaseManifest) {
      const latestAppJSON = {
        ...latestJSON,
        meta_type: "app",
        meta_version: "0.11.8",
        appManifest: releaseManifest
      };
      releaseServer.type = type;
      releaseServer.mainRelease = latestAppJSON;
      return releaseServer;
    } else if (type == "client" && "name" in releaseManifest) {
      const latestAppJSON = {
        ...latestJSON,
        meta_type: "client",
        meta_version: "0.11.8",
        clientManifest: releaseManifest
      };
      releaseServer.type = type;
      releaseServer.mainRelease = latestAppJSON;
      return releaseServer;
    } else {
      throw new Error(`Failed to find the correct manifest.json. found ${releaseManifest.id}`);
    }
  } catch (error) {
    Logger.warn(`(Expected Error) Error fetching and unzipping file: ${handleError(error)}`);
  }
  const author = releaseFile?.uploader?.login || latestRelease.author.login || "Unknown";
  const version = latestRelease.tag_name || "Unknown";
  if (type == "app") {
    const appRelease = {
      ...latestJSON,
      meta_type: "app",
      meta_version: "0.11.8",
      appManifest: {
        id: fileId,
        label: fileId,
        requires: [],
        version,
        description: "Unknown Description",
        author,
        platforms: [],
        tags: [],
        requiredVersions: {
          server: "0.0.0",
          client: "0.0.0"
        }
      }
    };
    releaseServer.type = type;
    releaseServer.mainRelease = appRelease;
    return releaseServer;
  } else {
    const clientRelease = {
      ...latestJSON,
      meta_type: "client",
      meta_version: "0.11.8",
      clientManifest: {
        id: fileId,
        name: fileId,
        short_name: fileId,
        version,
        description: "Unknown",
        author,
        compatibility: {
          server: "0.0.0",
          app: "0.0.0"
        },
        reactive: false,
        repository: "",
        context: {
          id: ClientPlatformIDs.Unknown,
          name: "",
          ip: "",
          port: 0,
          method: ClientConnectionMethod.Unknown
        }
      }
    };
    releaseServer.type = type;
    releaseServer.mainRelease = clientRelease;
    return releaseServer;
  }
};
const reconstructReleaseBasedOnZipAsset = async (releaseAsset, repoUrl, appId) => {
  const { debug } = Logger.createLogger({
    method: "reconstructReleaseBasedOnZipAsset",
    store: "migrationUtils"
  });
  debug(
    `No app or client files found in the latest release - attempting to download and unzip file ${releaseAsset.name} to try and determine type`
  );
  let manifest;
  try {
    manifest = await fetchAndUnzipFileToGetManifest(releaseAsset);
  } catch (error) {
    throw new Error(`Failed to unzip file ${releaseAsset.name}. ${handleError(error)}`);
  }
  let type;
  if ("name" in manifest) {
    type = "client";
  } else {
    type = "app";
  }
  const githubStore = await storeProvider.getStore("githubStore");
  const allReleases = await githubStore.getAllReleases(repoUrl);
  const fileId = appId || releaseAsset.name.split("-")[0];
  const pastReleases = collectPastReleases(allReleases, fileId);
  const totalDownloads = pastReleases.reduce((acc, release) => acc + release.downloads, 0);
  const latestJSON = {
    repository: repoUrl,
    updateUrl: releaseAsset.browser_download_url,
    downloads: releaseAsset.download_count,
    size: releaseAsset.size,
    updatedAt: new Date(releaseAsset.updated_at).getTime(),
    createdAt: new Date(releaseAsset.created_at).getTime()
  };
  const releaseServer = {
    id: fileId,
    type,
    lastUpdated: Date.now(),
    totalDownloads,
    pastReleases
  };
  if (type == "app" && "label" in manifest) {
    const latestAppJSON = {
      ...latestJSON,
      meta_type: "app",
      meta_version: "0.11.8",
      appManifest: manifest
    };
    releaseServer.type = type;
    releaseServer.mainRelease = latestAppJSON;
    return releaseServer;
  } else if (type == "client" && "name" in manifest) {
    const latestAppJSON = {
      ...latestJSON,
      meta_type: "client",
      meta_version: "0.11.8",
      clientManifest: manifest
    };
    releaseServer.type = type;
    releaseServer.mainRelease = latestAppJSON;
    return releaseServer;
  } else {
    throw new Error(`Failed to find the correct manifest.json. found ${manifest.id}`);
  }
};
const fetchAndUnzipFileToGetManifest = async (releaseFile) => {
  const { debug, log } = Logger.createLogger({
    method: "fetchAndUnzipFileToGetManifest",
    store: "migrationUtils"
  });
  const tempPath = path.join(app.getPath("temp"), `release-${Date.now()}.zip`);
  debug(`Downloading file: ${releaseFile.browser_download_url}`);
  log(`Saving to: ${tempPath}`);
  const response = await fetch(releaseFile.browser_download_url);
  const buffer = await response.arrayBuffer();
  await writeFile(tempPath, Buffer.from(buffer));
  debug(`Unzipping file: ${tempPath}`);
  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(tempPath);
    const manifestEntry = zip.getEntries().find((entry) => entry.entryName.endsWith("manifest.json"));
    debug(`Found manifest entry: ${manifestEntry?.entryName}`);
    if (!manifestEntry) {
      throw new Error("manifest.json not found in zip file");
    }
    const manifestContent = manifestEntry.getData().toString("utf8");
    debug(`Extracting manifest entry: ${manifestEntry.entryName}`);
    const manifest = JSON.parse(manifestContent);
    return manifest;
  } finally {
    await unlink(tempPath).catch(() => {
    });
  }
};
const saveAppReleaseData = async (appReleaseFile) => {
  try {
    const appReleasePath = join("system", "appReleases.json");
    await writeToFile(appReleaseFile, appReleasePath);
  } catch (error) {
    Logger.error(`Failed to save app release files`, {
      error,
      function: "saveAppReleaseFile",
      source: "releaseFileService"
    });
    throw new Error(`Failed to save app release data`, { cause: error });
  }
};
const saveClientReleaseData = async (clientReleaseFile) => {
  try {
    const clientReleasePath = join("system", "clientReleases.json");
    await writeToFile(clientReleaseFile, clientReleasePath);
  } catch (error) {
    Logger.error(`Failed to save client release files`, {
      error,
      function: "saveClientReleaseFile",
      source: "releaseFileService"
    });
    throw new Error(`Failed to save app release data`, { cause: error });
  }
};
const readAppReleaseData = async () => {
  try {
    const appReleasePath = join("system", "appReleases.json");
    const appReleaseFile = await readFromFile(appReleasePath);
    if (!appReleaseFile) throw new Error("Invalid app release file (does not exist)");
    return assertReleaseFileMigration(appReleaseFile);
  } catch (error) {
    Logger.error(`Failed to read app release files`, {
      error,
      function: "readAppReleaseData",
      source: "releaseFileService"
    });
    throw new Error(`Failed to read app release data`, { cause: error });
  }
};
const readClientReleaseData = async () => {
  try {
    const clientReleasePath = join("system", "clientReleases.json");
    const clientReleaseFile = await readFromFile(clientReleasePath);
    if (!clientReleaseFile) throw new Error("Invalid client release file (does not exist)");
    return assertReleaseFileMigration(clientReleaseFile);
  } catch (error) {
    Logger.error(`Failed to read client release files`, {
      error,
      function: "readClientReleaseData",
      source: "releaseFileService"
    });
    throw new Error(`Failed to read app release data`, { cause: error });
  }
};
const fetchRepoSummary = async (repoUrl) => {
  const githubStore = await storeProvider.getStore("githubStore");
  const summary = await githubStore.getRepository(repoUrl);
  if (summary) return summary;
  throw new Error("Repository not found");
};
class ReleaseStore extends EventEmitter {
  appReleases;
  clientReleases;
  _initialized = false;
  get initialized() {
    return this._initialized;
  }
  constructor() {
    super();
  }
  initialize = async () => {
    if (this._initialized) return;
    this._initialized = true;
  };
  clearCache = async () => {
    await this.saveAppReleaseFile(true);
    await this.saveClientReleaseFile(true);
  };
  saveToFile = async () => {
    await this.saveAppReleaseFile();
    await this.saveClientReleaseFile();
  };
  /**
   * Returns the cached version or the version from file - whichever is more updated
   */
  getClientReleaseFile = async () => {
    if (this.clientReleases) return this.clientReleases;
    const { debug, warn } = Logger.createLogger({
      method: "getClientReleaseFile",
      store: "releaseStore"
    });
    try {
      this.clientReleases = await readClientReleaseData();
      debug(`Received ${this.clientReleases?.releases?.length} client releases from file`);
      return this.clientReleases;
    } catch (error) {
      warn(`There was an error reading appReleaseFile ${handleError(error)}`);
      return;
    }
  };
  /**
   * Returns the cached version or the version from file - whichever is more updated
   */
  getAppReleaseFile = async () => {
    if (this.appReleases) return this.appReleases;
    try {
      this.appReleases = await readAppReleaseData();
      Logger.debug(`Received ${this.appReleases?.releases?.length} app releases from file`, {
        function: "getAppReleaseFile",
        source: "releaseStore"
      });
      return this.appReleases;
    } catch (error) {
      Logger.warn(`There was an error reading appReleaseFile ${handleError(error)}`, {
        error,
        function: "getAppReleaseFile",
        source: "releaseStore"
      });
      return;
    }
  };
  saveClientReleaseFile = async (clearCache = false) => {
    if (!this.clientReleases) {
      Logger.warn("Unable to save the client release file as it does not exist");
      return;
    }
    try {
      await saveClientReleaseData(this.clientReleases);
      this.emit("client", this.clientReleases.releases);
      this.emit("clientRepos", this.clientReleases.repositories);
      if (clearCache) this.clientReleases = void 0;
    } catch (error) {
      Logger.error(`Failed to save client release file: ${handleError(error)}`, {
        error,
        function: "saveClientReleaseFile",
        source: "releaseStore"
      });
    }
  };
  saveAppReleaseFile = async (clearCache = false) => {
    if (!this.appReleases) {
      Logger.warn("Unable to save the app release file as it does not exist");
      return;
    }
    try {
      await saveAppReleaseData(this.appReleases);
      this.emit("app", this.appReleases.releases);
      this.emit("appRepos", this.appReleases.repositories);
      if (clearCache) this.appReleases = void 0;
    } catch (error) {
      Logger.error(`Failed to save app release file: ${handleError(error)}`, {
        error,
        function: "saveClientReleaseFile",
        source: "releaseStore"
      });
    }
  };
  /**
   * ---------------------------
   * Public Methods
   */
  /**
   * Gets the app and client releases from file, checks if their cache is valid, and updates them if they're not
   * @param force - If true, will force a refresh even if the cache is valid
   */
  refreshData = async (force) => {
    progressBus.startOperation(
      ProgressChannel.ST_RELEASE_REFRESH,
      "Refreshing Both Releases",
      "Initializing",
      [
        {
          channel: ProgressChannel.ST_RELEASE_APP_REFRESH,
          weight: 50
        },
        {
          channel: ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
          weight: 50
        }
      ]
    );
    await this.refreshApps(force);
    await this.refreshClients(force);
    progressBus.complete(
      ProgressChannel.ST_RELEASE_REFRESH,
      "Refresh Complete",
      "Refreshing Releases"
    );
  };
  refreshApps = async (force) => {
    progressBus.startOperation(
      ProgressChannel.ST_RELEASE_APP_REFRESH,
      "Refreshing App Releases",
      "Initializing App Release",
      [
        {
          channel: ProgressChannel.FN_RELEASE_APP_REFRESH,
          weight: 100
        }
      ]
    );
    try {
      const appReleases = await this.getAppReleaseFile();
      if (!appReleases) {
        throw new Error("AppReleases is undefined!");
      }
      if (force || !isCacheValid(appReleases)) {
        this.appReleases = await handleRefreshReleaseFile("app", appReleases, {
          force,
          updateStates: true
        });
        if (this.appReleases.releases.length == 0) {
          const { appsRepo } = await import("./releaseMetadata-CXAQDd4G.js");
          await this.addRepositoryUrl(appsRepo);
        }
        await this.saveAppReleaseFile(false);
        progressBus.complete(
          ProgressChannel.ST_RELEASE_APP_REFRESH,
          "Finished fetching initial app release file"
        );
        return;
      } else {
        progressBus.complete(
          ProgressChannel.ST_RELEASE_APP_REFRESH,
          "AppReleases is up to date (cache is up to date)"
        );
        return;
      }
    } catch (error) {
      progressBus.warn(
        ProgressChannel.ST_RELEASE_APP_REFRESH,
        `Fetching initial app file because ${handleError(error)}`
      );
      this.appReleases = await createReleaseFile("app", force);
      if (this.appReleases.releases.length == 0) {
        const { appsRepo } = await import("./releaseMetadata-CXAQDd4G.js");
        await this.addRepositoryUrl(appsRepo);
      }
      await this.saveAppReleaseFile(false);
      progressBus.complete(
        ProgressChannel.ST_RELEASE_APP_REFRESH,
        "Finished fetching initial app release file"
      );
      return;
    }
  };
  refreshClients = async (force) => {
    progressBus.startOperation(
      ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
      "Refreshing App Releases",
      "Initializing",
      [
        {
          channel: ProgressChannel.FN_RELEASE_CLIENT_REFRESH,
          weight: 100
        }
      ]
    );
    try {
      const clientReleases = await this.getClientReleaseFile();
      if (!clientReleases) {
        throw new Error("ClientReleases is undefined!");
      }
      if (force || !isCacheValid(clientReleases)) {
        this.clientReleases = await handleRefreshReleaseFile("client", clientReleases, {
          force,
          updateStates: true
        });
        if (this.clientReleases.releases.length == 0) {
          const { clientRepo } = await import("./releaseMetadata-CXAQDd4G.js");
          await this.addRepositoryUrl(clientRepo);
        }
        await this.saveClientReleaseFile(false);
        progressBus.complete(
          ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
          "Finished fetching initial client release file"
        );
        return;
      } else {
        progressBus.complete(
          ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
          "ClientReleases is up to date (cache is up to date)"
        );
        return;
      }
    } catch (error) {
      progressBus.warn(
        ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
        `Fetching initial client file because ${handleError(error)}`
      );
      this.clientReleases = await createReleaseFile("client", force);
      if (this.clientReleases.releases.length == 0) {
        const { clientRepo } = await import("./releaseMetadata-CXAQDd4G.js");
        await this.addRepositoryUrl(clientRepo);
      }
      await this.saveClientReleaseFile(false);
      progressBus.complete(
        ProgressChannel.ST_RELEASE_CLIENT_REFRESH,
        "Finished fetching initial clientReleases release file"
      );
      return;
    }
  };
  getCommunityApps = async () => {
    const apps = await this.getAppReleaseFile();
    if (!apps) return void 0;
    return apps.repositories;
  };
  getCommunityClients = async () => {
    const clients = await this.getClientReleaseFile();
    if (!clients) return void 0;
    return clients.repositories;
  };
  getAllRepositories = async () => {
    const totalRepos = await this.getAvailableRepositories();
    const githubRepos = [];
    for (const repo of totalRepos) {
      try {
        const summary = await fetchRepoSummary(repo);
        githubRepos.push(summary);
      } catch (err) {
        Logger.warn(`Failed to fetch summary for repo ${repo}: ${handleError(err)}`, {
          error: err,
          function: "getAllRepositories",
          source: "releaseStore"
        });
      }
    }
    Logger.info(`Fetched ${githubRepos.length} out of ${totalRepos.length} repositories`, {
      function: "getAllRepositories",
      source: "releaseStore"
    });
    return githubRepos;
  };
  getAppReleases = async () => {
    const apps = await this.getAppReleaseFile();
    if (!apps) return void 0;
    return apps.releases;
  };
  getClientReleases = async () => {
    const clients = await this.getClientReleaseFile();
    if (!clients) return void 0;
    return clients.releases;
  };
  getAppRelease = async (appId) => {
    const appReleases = await this.getAppReleaseFile();
    if (!appReleases) return void 0;
    return appReleases.releases.find((app2) => app2.id === appId);
  };
  getClientRelease = async (clientId) => {
    const clients = await this.getClientReleaseFile();
    if (!clients) return void 0;
    if (clientId) {
      return clients.releases.find((client) => client.id === clientId);
    } else {
      return clients.releases[0];
    }
  };
  getAvailableRepositories = async () => {
    const repos = [
      ...this.clientReleases?.repositories || [],
      ...this.appReleases?.repositories || []
    ];
    return repos.filter((repo, index, self) => {
      const isValidGitUrl = (repo.startsWith("https://github.com/") || repo.startsWith("https://api.github.com/repos/") || repo.startsWith("git@github.com:") || repo.startsWith("https://gitlab.com/")) && repo.split("/").length >= 3;
      return isValidGitUrl && self.indexOf(repo) === index;
    });
  };
  addRepositoryUrl = async (repoUrl) => {
    try {
      progressBus.startOperation(
        ProgressChannel.ST_RELEASE_ADD_REPO,
        "Adding Repo",
        `Adding ${repoUrl}`,
        [
          {
            weight: 100,
            channel: ProgressChannel.FN_RELEASE_ADD_REPO
          }
        ]
      );
      Logger.debug(`Adding repository: ${repoUrl}`, {
        function: "addRepositoryUrl",
        source: "releaseStore"
      });
      const result = await addRepositoryUrl(repoUrl);
      if (result.type === "client") {
        await this.addClientToReleases(result, repoUrl);
        return [result];
      } else if (result.type === "converted-clients") {
        if (result.releases.length > 0) {
          for (const clientRelease of result.releases) {
            await this.addClientToReleases(clientRelease, repoUrl);
          }
          return result.releases;
        }
      } else if (result.type === "app") {
        await this.addAppToReleases(result, repoUrl);
        return [result];
      } else if (result.type === "converted-apps") {
        if (result.releases.length > 0) {
          for (const appRelease of result.releases) {
            await this.addAppToReleases(appRelease, repoUrl);
          }
          return result.releases;
        }
      }
      Logger.warn(`No releases found in repository: ${repoUrl}`, {
        function: "addRepositoryUrl",
        source: "releaseStore"
      });
      return void 0;
    } catch (error) {
      Logger.error(`Failed to add repository ${repoUrl}: ${handleError(error)}`, {
        error,
        function: "addRepositoryUrl",
        source: "releaseStore"
      });
      return void 0;
    }
  };
  addClientToReleases = async (clientRelease, repoUrl) => {
    const clientReleases = await this.getClientReleaseFile();
    const { debug } = Logger.createLogger({
      function: "addClientToReleases",
      source: "releaseStore"
    });
    if (!clientReleases) {
      Logger.error("Unable to find client release file!", {
        function: "addClientToReleases",
        source: "releaseStore"
      });
      return;
    }
    const existingIndex = clientReleases.releases.findIndex(
      (existing) => existing.id === clientRelease.id
    );
    if (existingIndex !== -1) {
      clientReleases.releases[existingIndex] = clientRelease;
      debug(`Updated existing client release: ${clientRelease.id}`);
    } else {
      clientReleases.releases.push(clientRelease);
      debug(`Added new client release: ${clientRelease.id}`);
    }
    clientReleases.timestamp = Date.now();
    this.clientReleases = clientReleases;
    await this.saveClientReleaseFile(false);
    Logger.info(
      `Successfully added/updated client ${clientRelease.id} from repository ${repoUrl}`,
      {
        function: "addClientToReleases",
        source: "releaseStore"
      }
    );
    this.emit("client", clientReleases.releases);
  };
  addAppToReleases = async (appRelease, repoUrl) => {
    const appReleases = await this.getAppReleaseFile();
    const { debug, error } = Logger.createLogger({
      method: "addAppToReleases",
      store: "releaseStore"
    });
    if (!appReleases) {
      error("Unable to find app release file!");
      return;
    }
    const existingIndex = appReleases.releases.findIndex(
      (existing) => existing.id === appRelease.id
    );
    if (existingIndex !== -1) {
      appReleases.releases[existingIndex] = appRelease;
      debug(`Updated existing app release: ${appRelease.id}`);
    } else {
      appReleases.releases.push(appRelease);
      debug(`Added new app release: ${appRelease.id}`);
    }
    appReleases.timestamp = Date.now();
    this.appReleases = appReleases;
    await this.saveClientReleaseFile(false);
    Logger.info(`Successfully added/updated app ${appRelease.id} from repository ${repoUrl}`, {
      function: "addAppToReleases",
      source: "releaseStore"
    });
    this.emit("app", appReleases.releases);
  };
  removeAppRelease = async (appId) => {
    progressBus.start(
      ProgressChannel.ST_RELEASE_APP_REMOVE,
      "Removing App Release",
      `Removing ${appId}`
    );
    if (!appId) {
      progressBus.error(
        ProgressChannel.ST_RELEASE_APP_REMOVE,
        "No repository URL or app ID provided"
      );
      return;
    }
    const appReleases = await this.getAppReleaseFile();
    if (!appReleases) {
      progressBus.error(ProgressChannel.ST_RELEASE_APP_REMOVE, "No app releases found");
      return;
    }
    const existingIndex = appReleases.releases.findIndex((existing) => existing.id === appId);
    if (existingIndex !== -1) {
      appReleases.releases.splice(existingIndex, 1);
      appReleases.timestamp = Date.now();
      this.appReleases = appReleases;
      await this.saveClientReleaseFile(false);
      progressBus.complete(
        ProgressChannel.ST_RELEASE_APP_REMOVE,
        `Successfully removed app release ${appId}`
      );
    } else {
      progressBus.error(
        ProgressChannel.ST_RELEASE_APP_REMOVE,
        `No app release found for app ID ${appId}`
      );
    }
    this.emit("app", appReleases.releases);
  };
  removeClientRelease = async (clientId) => {
    progressBus.start(
      ProgressChannel.ST_RELEASE_CLIENT_REMOVE,
      "Removing Client Release",
      `Removing ${clientId}`
    );
    if (!clientId) {
      progressBus.error(ProgressChannel.ST_RELEASE_CLIENT_REMOVE, "No client ID provided");
      return;
    }
    const clientReleases = await this.getClientReleaseFile();
    if (!clientReleases) {
      progressBus.error(ProgressChannel.ST_RELEASE_CLIENT_REMOVE, "No client releases found");
      return;
    }
    const existingIndex = clientReleases.releases.findIndex((existing) => existing.id === clientId);
    if (existingIndex !== -1) {
      clientReleases.releases.splice(existingIndex, 1);
      clientReleases.timestamp = Date.now();
      this.clientReleases = clientReleases;
      await this.saveClientReleaseFile(false);
      progressBus.complete(
        ProgressChannel.ST_RELEASE_CLIENT_REMOVE,
        `Successfully removed client release ${clientId}`
      );
    } else {
      progressBus.error(
        ProgressChannel.ST_RELEASE_CLIENT_REMOVE,
        `No client release found for client ID ${clientId}`
      );
    }
    this.emit("client", clientReleases.releases);
  };
  downloadLatestApp = async (appId) => {
    try {
      progressBus.startOperation(
        ProgressChannel.ST_RELEASE_APP_DOWNLOAD,
        `Downloading ${appId}`,
        "Initializing",
        [
          {
            channel: ProgressChannel.ST_APP_INSTALL,
            weight: 100
          }
        ]
      );
      const appRelease = await this.getAppRelease(appId);
      if (!appRelease) return;
      const appStore = await storeProvider.getStore("appStore");
      const appManifest = await appStore.addApp({
        filePath: appRelease.mainRelease.updateUrl,
        releaseMeta: appRelease.mainRelease
      });
      progressBus.complete(
        ProgressChannel.ST_RELEASE_APP_DOWNLOAD,
        `Completed downloading ${appId}`
      );
      return appManifest;
    } catch (error) {
      progressBus.error(
        ProgressChannel.ST_RELEASE_APP_DOWNLOAD,
        `There was an error trying to download the app ${appId}. ${handleError(error)}`,
        "Error Downloading App"
      );
      return;
    }
  };
  downloadLatestClient = async (clientId) => {
    try {
      progressBus.startOperation(
        ProgressChannel.ST_RELEASE_CLIENT_DOWNLOAD,
        "Downloading Client",
        "Initializing",
        [
          {
            channel: ProgressChannel.ST_CLIENT_DOWNLOAD,
            weight: 100
          }
        ]
      );
      Logger.debug("Downloading client");
      const clientRelease = await this.getClientRelease(clientId);
      if (!clientRelease) {
        Logger.debug("Client Release not found for " + clientId || "Latest Client");
        return;
      }
      const clientStore = await storeProvider.getStore("clientStore");
      const clientManifest = await clientStore.loadClientFromURL(
        clientRelease.mainRelease.updateUrl
      );
      progressBus.complete(ProgressChannel.ST_RELEASE_CLIENT_DOWNLOAD, "Completed the Download");
      return clientManifest;
    } catch (error) {
      progressBus.error(
        ProgressChannel.ST_RELEASE_CLIENT_DOWNLOAD,
        `There was an error trying to download the client ${clientId || "Latest Client"}. ${handleError(error)}`,
        "Error Downloading Client"
      );
      return;
    }
  };
}
export {
  ReleaseStore
};
