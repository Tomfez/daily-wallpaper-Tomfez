const { HttpSession } = require("./httpSession");
const { Utils } = require("./utils");

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

class Source {
    constructor(source, metaDataPath, wallpaperPath) {
        this.url;
        this.imageData;
        this.copyrightsAutor;
        this.copyrights;
        this.description;
        this.wallpaperDate;
        this.imageURL;
        this.filename;
        this.metaDataPath = metaDataPath;
        this.wallpaperPath = wallpaperPath;
        this.source = source;
        this.httpSession = new HttpSession();

        switch (source) {
            case "wikimedia":
                this.host = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/`;
                break;
            case "bing":
            default:
                this.host = "https://www.bing.com";
                break;
        }
    }

    getMetaData(url, callback, callbackError) {
        const writeFile = data => {
            if (data === false) {
                callbackError();
            } else {
                // const json = JSON.parse(data);

                // let filename = json.query.pages[0].images[0].title;
                // this.fetch_image_src(filename);
                // global.log(image_src);
                // Write to meta data file
                let gFile = Gio.file_new_for_path(this.metaDataPath);
                let fStream = gFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
                let toWrite = data.length;
                while (toWrite > 0)
                    toWrite -= fStream.write(data, null);
                fStream.close(null);

                this.getMetaDataLocal();
                callback();
            }
        };

        this.httpSession.queryMetada(this.host + url, writeFile);
    }

    getMetaDataLocal() {
        const data = GLib.file_get_contents(this.metaDataPath)[1];
        const json = JSON.parse(data);

        if (this.source === "bing") {
            this.imageData = json.images[0];

            this.copyrights = this.imageData.copyright;
            const copyrightsSplit = Utils.splitCopyrightsText(this.imageData.copyright);
            this.description = copyrightsSplit[0];
            this.copyrightsAutor = copyrightsSplit[1];

            this.wallpaperDate = this.imageData.enddate;
            this.url = `${this.host}${this.imageData.url}`;
            this.imageURL = this.imageData.url;

            // const currentDate = this.imageData.enddate;
            // this.filename = `BingWallpaper_${currentDate}.jpg`;
        } else {
                this.imageData = json.image;

                if (this.imageData.length === 0) {
                    Utils.log("no image today");
                    return;
                }
                this.description = this.imageData.description.text; //the description can be very long and can causes issues in the PanelMenu if too long. I prefer to keep it short here. Maybe set a max-size on the Panel ?
                let descrCut = this.description.slice(0, 50) + (this.description.length > 50 ? "..." : "");
                this.description = descrCut;

                //TODO: Set an option to choose between original filename or filename with a date
                let title = this.imageData.title.split(":");
                title = title[1].substring(0, title[1].lastIndexOf('.')); // removes the extension in the filename
                this.copyrights = title;
                this.copyrightsAutor = this.imageData.artist.text;

                this.imageURL = this.imageData.image.source;
                // this.wallpaperDate = 
                // this.filename = `Wikimedia_${this.wallpaperDate}.jpg`;
            // }

            // let params = {
            //     "action": "query",
            //     "format": "json",
            //     "prop": "imageinfo",
            //     "iiprop": "url",
            //     "titles": filename
            // }

            // let url = "?origin=*";
            // Object.keys(params).forEach(function (key) { url += "&" + key + "=" + params[key]; });

            // this.httpSession.queryMetada(this.host + url, process_result);
        }
    }

    downloadImage(callback, callbackError) {
        const res = data => {
            if (data === false)
                callbackError();
            else
                callback();
        }

        if (this.source === "bing") {
            //If metadata ok, we download the image
            const regex = /_\d+x\d+./gm;
            const urlUHD = this.url.replace(regex, `_UHD.`);
            this.httpSession.downloadImageFromUrl(urlUHD, this.wallpaperPath, res);
        } else {
            this.httpSession.downloadImageFromUrl(this.imageURL, this.wallpaperPath, res);
        }
    }
}

module.exports = { Source }