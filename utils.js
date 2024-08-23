const GLib = imports.gi.GLib;
const logging = true;

class Utils {

    /**
     * log
     * @param {string} message - The message to display
     */
    static log(message) {
        if (logging) {
            if (typeof message === 'object' && !Array.isArray(message) && message !== null) {
                const objectJson = JSON.stringify(message);
                global.log(objectJson);
            } else {
                global.log(`[bing-wallpaper@tom.dev]: ${message}`);
            }
        }
    }

    /**
     * delay
     * @param {number} ms - Number of milliseconds
     * @returns {Promise<void>} - Returns a Promise
     */
    static async delay(ms) {
        return await new Promise((resolve) => {
            setTimeout(() => {
                resolve();
            }, ms);
        });
    }

    /**
     * formatFolderName
     * @param {string} wallpaperDir - Location of wallpaper
     * @returns {string} Returns the wallpaper directory formated
     */
    static formatFolderName(wallpaperDir) {
        if (wallpaperDir.startsWith("file://")) {
            wallpaperDir = wallpaperDir.slice("file://".length);

            // Removes '%' and return a valid path with accents
            wallpaperDir = decodeURIComponent(wallpaperDir);
            this.log("new wall dir: " + wallpaperDir);
        }

        return wallpaperDir;
    }

    /**
     * friendly_time_diff
     * @param {GLib.DateTime} time - The DateTime object to compare
     * @param {boolean} short - True to display short unit of time, false to display long unit of time
     * @returns {string} - Returns a next refresh datetime as a string
     */
    static friendly_time_diff(time, short) {
        // short we want to keep ~4-5 characters
        let now = GLib.DateTime.new_now_local().to_unix();
        let seconds = time.to_unix() - now;

        if (seconds <= 0) {
            return "now";
        }
        else if (seconds < 60) {
            return "< 1 " + (short ? "m" : _("minutes"));
        }
        else if (seconds < 3600) {
            return Math.round(seconds / 60) + " " + (short ? "m" : _("minutes"));
        }
        else if (seconds > 86400) {
            return Math.round(seconds / 86400) + " " + (short ? "d" : _("days"));
        }
        else {
            return Math.round(seconds / 3600) + " " + (short ? "h" : _("hours"));
        }
    }

    /**
     * splitCopyrightsText
     * @param {string} text - Copyrights text 
     * @returns {Array[string]|string} - Returns the text split if not empty, else returns the text 
     */
    static splitCopyrightsText(text) {
        if (text.length > 0)
            return text.split(/(?=\(©)/g);

        return text;
    }

    /**
     * getNewWallpaperDate
     * @param {string} date - The date to format (date as YYYYMMDD format)
     * @returns {GLib.DateTime} - Returns 
     */
    static getNewWallpaperDate(date) {
        const day = date.substring(date.length - 2);
        return GLib.DateTime.new_utc(2024, 8, day, 15, 12, 30);
    }

    /**
     * getUserLanguage
     * @returns {string} - Returns the current environment language
     */
    static getUserLanguage() {
        return GLib.getenv("LANG").split(".")[0].replace("_", "-");
    }
}

module.exports = { Utils }