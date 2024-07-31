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
     * formatFolderName
     * @param {string} wallpaperDir - Location of wallpaper
     * @returns 
     */
    static formatFolderName(wallpaperDir) {
        if (wallpaperDir.startsWith("file://"))
            wallpaperDir = wallpaperDir.slice("file://".length);

        this.log("new wall dir: " + wallpaperDir);
        return wallpaperDir;
    }

    getWallpaperDir(settings) {
        let homeDir =  GLib.get_home_dir(); 
        let BingWallpaperDir = settings.get_string('download-folder').replace('~', homeDir); 
        let userPicturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
        let userDesktopDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP); // seems to be a safer default
        if (BingWallpaperDir == '') {
            BingWallpaperDir = (userPicturesDir?userPicturesDir:userDesktopDir) + '/BingWallpaper/';
            BingLog('Using default download folder: ' + BingWallpaperDir);
            setWallpaperDir(settings, BingWallpaperDir);
        }
        else if (!BingWallpaperDir.endsWith('/')) {
            BingWallpaperDir += '/';
        }
    
        let dir = Gio.file_new_for_path(BingWallpaperDir);
        if (!dir.query_exists(null)) {
            dir.make_directory_with_parents(null);
        }
        //FIXME: test if dir is good and writable
        return BingWallpaperDir;
    }

    /**
     * friendly_time_diff
     * @param {GLib.DateTime} time - The DateTime object to compare
     * @param {boolean} short - True to display short unit of time, false to display long unit of time
     * @returns 
     */
    static friendly_time_diff(time, short = true) {
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
}

module.exports = { Utils }