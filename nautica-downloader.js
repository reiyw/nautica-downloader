const base = 'https://ksm.dev';

const axios = require('axios').create({
  baseURL: `${base}/app`
});

const minimist = require('minimist');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment');
const rimraf = require('rimraf');
const iconv = require('iconv-lite');
const child_process = require('child_process');
const mkdirp = require('mkdirp');

class NauticaDownloader {
  constructor() {
    this.createNauticaDirectory();
  }

  /**
   * Iterates through every song provided by Nautica since the last execution time and downloads them
   * @param shouldContinue - default false. if true, will not short-circuit execution when 5 up to date songs are encountered
   */
  async downloadAll(shouldContinue) {
    console.log('Downloading all songs.');

    let response;
    let consecutiveUpToDates = 0;
    AllDoLoop:
    do {
      // fetch the songs
      response = (await axios.get(response ? response.links.next : 'songs?sort=uploaded')).data;
      for (let i = 0; i < response.data.length; i++) {
        let song = response.data[i];
        console.log('=====================');
        console.log(`Song: ${song.title} - ${song.artist}`);


        let lastDownloaded = this.getWhenSongWasLastDownloaded(song.id);
        if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
          // we're up to date! break out.
          console.log('Already up to date! Skipping.');
          this.setWhenSongWasLastDownloaded(song.id);
          if (shouldContinue || consecutiveUpToDates < 4) {
            consecutiveUpToDates++;
            continue;
          }
          console.log('Found five consecutive songs that were up to date. Stopping execution.');
          console.log('To prevent this from happening, run with the --continue flag.');
          break AllDoLoop;
        }

        // if we reach here, that means we should reset the counter of consecutive up to dates
        consecutiveUpToDates = 0;

        try {
          await this.downloadSongToUserDirectory(song);
          this.setWhenSongWasLastDownloaded(song.id);
        } catch (e) {
          console.log('Error encountered:');
          console.log(e);
          return;
        }
      }
    } while (response.links.next);
    console.log('=====================');
    console.log('Done!');
  }

  /**
   * Iterates through every song for a user since the last execution time and downloads them
   * @param userId - userId to download
   * @param shouldContinue - default false. if true, will not short-circuit execution when 5 up to date songs are encountered
   */
  async downloadUser(userId, shouldContinue) {
    console.log(`Downloading ${userId}'s songs.`);
    // grab the last time this script was ran

    let response;
    let consecutiveUpToDates = 0;
    UserDoLoop:
    do {
      // fetch the songs
      response = (await axios.get(response ? response.links.next : `users/${userId}/songs?sort=uploaded`)).data;
      for (let i = 0; i < response.data.length; i++) {
        let song = response.data[i];
        console.log('=====================');
        console.log(`Song: ${song.title} - ${song.artist}`);

        let lastDownloaded = this.getWhenSongWasLastDownloaded(song.id);
        if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
          // we're up to date! break out.
          console.log('Already up to date! Skipping.');
          this.setWhenSongWasLastDownloaded(song.id);

          if (shouldContinue || consecutiveUpToDates < 4) {
            consecutiveUpToDates++;
            continue;
          }
          console.log('Found five consecutive songs that were up to date. Stopping execution.');
          console.log('To prevent this from happening, run with the --continue flag.');
          break UserDoLoop;
        }

        // if we reach here, that means we should reset the counter of consecutive up to dates
        consecutiveUpToDates = 0;

        try {
          await this.downloadSongToUserDirectory(song);
          this.setWhenSongWasLastDownloaded(song.id);
        } catch (e) {
          console.log('Error encountered:');
          console.log(e);
        }
      }
    } while (response.links.next);
    console.log('=====================');
    console.log('Done!');
  }

  /**
   * Downloads a specific song
   * @param songId - id of the song to download
   */
  async downloadSong(songId) {
    console.log(`Downloading song ${songId}.`);

    try {
      const song = (await axios.get(`songs/${songId}`)).data.data;

      console.log('=====================');
      console.log(`Song: ${song.title} - ${song.artist}`);

      let lastDownloaded = this.getWhenSongWasLastDownloaded(songId);
      if (lastDownloaded && moment(song.uploaded_at).subtract(7, 'hours').unix() <= lastDownloaded) {
        // we're up to date! break out.
        console.log('Already up to date!');
      } else {
        await this.downloadSongToUserDirectory(song);
      }

      this.setWhenSongWasLastDownloaded(songId);
      console.log('=====================');
      console.log('Done!');
    } catch (e) {
      console.log('Error encountered:');
      console.log(e);
    }
  }

  /**
   * Given a song object, write it to disk
   */
  async downloadSongToUserDirectory(songObj) {
    return new Promise(async (resolve, reject) => {
      this.createUserDirectory(songObj.user);

      const userDirectoryName = this.getUserDirectoryName(songObj.user);

      const songZipName = this.cleanName(`${songObj.id}.zip`);

      console.log(`Downloading ${songObj.title} - ${songObj.artist}`);

      let data;
      try {
        data = (await axios.get(`songs/${songObj.id}/download`, {
          baseURL: base,
          responseType: 'arraybuffer'
        })).data;
      } catch (e) {
        console.log('Error encountered when downloading the zip file');
        console.log(e);
        resolve();
        return;
      }

      fs.writeFileSync(path.resolve(`${dest}/${songZipName}`), data)

      console.log(`Finished downloading ${songObj.title} - ${songObj.artist}. Extracting...`);

      try {
        await this.extract(
          path.resolve(`${dest}/${songZipName}`),
          path.resolve(`${dest}/${userDirectoryName}`)
        );
      } catch (e) {
        console.log(e);
        console.log(`Error encountered when extracting ${songZipName}`);
        resolve();
        return;
      }

      console.log(`Finished extracting ${songObj.title} - ${songObj.artist}. Deleting old zip and cleaning up...`);

      fs.unlinkSync(path.resolve(`${dest}/${songZipName}`));

      console.log(`Deleted old zip. Finished download!`);

      resolve();
    });
  }

  /**
   * Creates the nautica directory.
   */
  createNauticaDirectory() {
    if (!fs.existsSync(path.resolve(dest))) {
      console.log('Creating destination directory...');
      fs.mkdirSync(path.resolve(dest));
    }
  }

  /**
   * Creates a user's directory.
   */
  createUserDirectory(user) {
    const userDirectoryName = this.getUserDirectoryName(user);

    if (!fs.existsSync(path.resolve(`${dest}/${userDirectoryName}`))) {
      fs.mkdirSync(path.resolve(`${dest}/${userDirectoryName}`));
    }
  }

  /**
   * Gets the directory name for a user. Stores it inside meta.
   */
  getUserDirectoryName(user) {
    if (!fs.existsSync(path.resolve(`${dest}/meta.json`))) {
      fs.writeFileSync(path.resolve(`${dest}/meta.json`), JSON.stringify({}), 'utf8');
    }

    const meta = JSON.parse(fs.readFileSync(path.resolve(`${dest}/meta.json`))); 

    if (!meta.users || !meta.users[user.id]) { 
      console.log('New user found, adding to list of users');

      if (!meta.users) {
        meta.users = {};
      }

      const userDirectoryName = this.cleanName(user.name);  
      meta.users[user.id] = userDirectoryName;
      fs.writeFileSync(path.resolve(`${dest}/meta.json`), JSON.stringify(meta), 'utf8');
      return userDirectoryName;
    }

    return meta.users[user.id];
  }

  cleanName(name) {
    return name.replace(/[:"?<>|*\/\\]/g, '-').replace(/^[\.]/, '-').replace(/[\.]$/, '-');
  }

  /**
   * Gets the last time this class fetched all the songs for a user.
   * Returns null if the script was never ran before.
   */
  getWhenSongWasLastDownloaded(songId) {
    if (!fs.existsSync(path.resolve(`${dest}/meta.json`))) {
      fs.writeFileSync(path.resolve(`${dest}/meta.json`), JSON.stringify({
        songDownloadTimes: {}
      }), 'utf8');
      return null;
    }

    const meta = JSON.parse(fs.readFileSync(path.resolve(`${dest}/meta.json`)));
    return meta.songDownloadTimes[songId];
  }

  /**
   * Sets the last time this class fetched all the songs for a user.
   */
  setWhenSongWasLastDownloaded(songId) {
    if (!fs.existsSync(path.resolve(`${dest}/meta.json`))) {
      fs.writeFileSync(path.resolve(`${dest}/meta.json`), JSON.stringify({
        songDownloadTimes: {}
      }), 'utf8');
    }
    const meta = JSON.parse(fs.readFileSync(path.resolve(`${dest}/meta.json`)));
    if (!meta.songDownloadTimes) {
      meta.songDownloadTimes = {}
    }

    meta.songDownloadTimes[songId] = moment().unix();
    fs.writeFileSync(path.resolve(`${dest}/meta.json`), JSON.stringify(meta), 'utf8');
  }

  /**
   * Extracts the contents of a zip on disk to a path w/ sjis encoding
   */
  extract(zipFilename, basePath) {
    return new Promise((resolve, reject) => {
      child_process.exec(`unar "${zipFilename}" -o "${basePath}" -f`, {
        cwd: basePath,
        windowsHide: true,
      }, (error, stdout, stderr) => {
        console.log(stdout);
        if (error) {
          console.log('Error encountered:');
          console.log(stderr);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

const args = minimist(process.argv.slice(2));

let dest = args.dest || './nautica';

downloader = new NauticaDownloader();

if (args.song) {
  downloader.downloadSong(args.song);
} else if (args.user) {
  downloader.downloadUser(args.user, !!args.continue);
} else {
  downloader.downloadAll(!!args.continue);
}

