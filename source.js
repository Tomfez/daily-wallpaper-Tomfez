const { HttpSession } = require("./httpSession");
const { Utils } = require("./utils");

const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const Soup = imports.gi.Soup;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const { Clipboard, ClipboardType } = imports.gi.St;
const Mainloop = imports.mainloop;
const Util = imports.misc.util;
const St = imports.gi.St;

class Source {
    constructor(source, metaDataPath, wallpaperPath) {
        this.metaDataPath = metaDataPath;
        this.wallpaperPath = wallpaperPath;
        this.source = source;
        this.url;
        this.imageData;
        this.copyrightsAutor;
        this.copyrights;
        this.description;
        this.wallpaperDate;
        this.imageURL;
        this.filename;
        this.h = new HttpSession();

        switch (source) {
            case "wikimedia":
                this.host = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/`;
                this.fetchWikiData();
                break;
            case "bing":
            default:
                this.host = "https://www.bing.com";
                this.fetchBingData();
                break;
        }
    }

    async fetchBingData() {
        const jsonString = GLib.file_get_contents(this.metaDataPath)[1];
        const json = JSON.parse(jsonString);

        //TODO: bloquer la lecture du json si l'auto update est desactivée
        if (!json.hasOwnProperty("tfa")) {
            this.imageData = json.images[0];
        }
    }

    getMetaData(url, callback) {
        const process_result = data => {
            // Write to meta data file
            let gFile = Gio.file_new_for_path(this.metaDataPath);
            let fStream = gFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
            let toWrite = data.length;
            while (toWrite > 0)
                toWrite -= fStream.write(data, null);
            fStream.close(null);

            const json = JSON.parse(data);

            if (this.source === "bing") {
                this.imageData = json.images[0];

                this.copyrights = this.imageData.copyright;
                const copyrightsSplit = Utils.splitCopyrightsText(this.imageData.copyright);
                this.description = copyrightsSplit[0];
                this.copyrightsAutor = copyrightsSplit[1];

                this.wallpaperDate = this.imageData.enddate;
                this.url = `${this.host}${this.imageData.url}`;

                const currentDate = this.imageData.enddate;
                this.filename = `BingWallpaper_${currentDate}.jpg`;
            } else {
                this.imageData = json.image;

                if (this.imageData === undefined) {
                    Utils.log("no image today");
                    return;
                }

                this.description = json.image.description.text; //the description can be very long and can causes issues in the PanelMenu if too long. I prefer to keep it short here. Maybe set a max-size on the Panel ?
                let descrCut = this.description.slice(0, 50) + (this.description.length > 50 ? "..." : "");
                this.description = descrCut;

                let title = json.image.title.split(":");
                title = title[1].substring(0, title[1].lastIndexOf('.')); // removes the extension in the filename
                this.copyrights = title;
                this.copyrightsAutor = json.image.artist.text;

                // const currentDateTime = GLib.DateTime.new_now_local();
                this.wallpaperDate = url.replaceAll('/', '-');
                this.imageURL = json.image.image.source;
                this.filename = `Wikimedia_${this.wallpaperDate}.jpg`;
            }

            callback();
        };

        this.h.queryMetada(this.host + url, process_result);
    }

    downloadImage(callback) {
        if (this.source === "bing") {
            //If metadata ok, we download the image
            const regex = /_\d+x\d+./gm;
            const urlUHD = this.url.replace(regex, `_UHD.`);
            this.h.downloadImageFromUrl(urlUHD, this.wallpaperPath, callback);
        } else {
            this.h.downloadImageFromUrl(this.imageURL, this.wallpaperPath, callback);
        }
    }

    async fetchWikiData() {
        const jsonString = GLib.file_get_contents(this.metaDataPath)[1];
        const json = JSON.parse(jsonString);

        //TODO: bloquer la lecture du json si l'auto update est desactivée
        if (json.hasOwnProperty("tfa")) {
            this.imageData = json.image;
        }
    }

    fetch_image_src(url, filename) {
        let _httpSession = new Soup.Session();
        let request = Soup.Message.new('GET', url);

        _httpSession.send_and_read_async(request, Soup.MessagePriority.NORMAL, null, (_httpSession, message) => {
            if (request.get_status() === 200) {
                const bytes = _httpSession.send_and_read_finish(message);

                //TODO: Set an option to choose between original filename or filename with a date
                if (bytes && bytes.get_size() > 0) {
                    let gFile = Gio.file_new_for_path(`${this.wallpaperPath}/${filename}`);
                    let fStream = gFile.replace(null, false, Gio.FileCreateFlags.NONE, null);

                    fStream.write(bytes.get_data(), null);
                    fStream.close(null);
                }
            } else {
                Utils.log(`Failed to acquire image metadata (${request.get_status()})`);
                // callbackError();
            }
        });
    }
}

module.exports = { Source }