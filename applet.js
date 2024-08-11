const { Utils } = require("./utils");
const { HttpSession } = require("./httpSession");

const Applet = imports.ui.applet;
const Soup = imports.gi.Soup;
const ByteArray = imports.byteArray;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const { Clipboard, ClipboardType } = imports.gi.St;
const Mainloop = imports.mainloop;
const Lang = imports.lang;
const PopupMenu = imports.ui.popupMenu; // /usr/share/cinnamon/js/ui/popupMenu.js
const Settings = imports.ui.settings;   // /usr/share/cinnamon/js/ui/settings.js
const Util = imports.misc.util;
const St = imports.gi.St;

const UUID = "bing-wallpaper@Tomfez";
let SettingsMap = {
    wallpaperDir: "Wallpaper path",
    saveWallpaper: false,
    refreshInterval: 300,
    dailyRefreshState: true
};

let _lastRefreshTime;
let _nextRefresh;
let _httpSession = new HttpSession();
let _idxWallpaper = 0;

const bingHost = 'https://www.bing.com';

function BingWallpaperApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

BingWallpaperApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    _init: function (metadata, orientation, panel_height, instance_id) {
        // Generic Setup
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        this.set_applet_icon_symbolic_name("bing-wallpaper");
        this.set_applet_tooltip('Bing Desktop Wallpaper');

        this._bindSettings(metadata, orientation, panel_height, instance_id);

        // We use this directory to store the current wallpaper and metadata
        const configPath = `${GLib.get_user_config_dir()}/bingwallpaper`;

        const configPathObj = Gio.file_new_for_path(configPath);

        if (!configPathObj.query_exists(null))
            configPathObj.make_directory(null);

        this.wallpaperPath = `${configPath}/BingWallpaper.jpg`;
        this.metaDataPath = `${configPath}/meta.json`;

        // Begin refresh loop
        this._refresh();

        // Wait 2s to get the metadata the first time the app is launched
        setTimeout(() => {
            this.setWallpaperDirectory(this.wallpaperDir);

            // #region -- Popup menu --
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);

            const copyrightSplit = Utils.splitCopyrightsText(this.imageData.copyright);
            this.wallpaperTextPMI = new PopupMenu.PopupMenuItem(copyrightSplit[0], {
                hover: false,
                style_class: 'copyright-text'
            });

            const copyrightSubText = copyrightSplit[1].slice(1, copyrightSplit[1].length - 1); //removes the '()'
            this.copyrightTextPMI = new PopupMenu.PopupMenuItem(copyrightSubText, {
                sensitive: false,
            });

            this.nextRefreshPMI = new PopupMenu.PopupMenuItem(this.refreshduetext, { sensitive: false });

            const refreshNowPMI = new PopupMenu.PopupMenuItem(_("Refresh now"));
            refreshNowPMI.connect('activate', Lang.bind(this, function () { this._refresh() }));

            const prevItem = new PopupMenu.PopupIconMenuItem(_("Previous"), "go-previous-symbolic", St.IconType.SYMBOLIC, {});
            const nextItem = new PopupMenu.PopupIconMenuItem(_("Next"), "go-next-symbolic", St.IconType.SYMBOLIC, {});

            prevItem.connect('activate', () => { this.getWallpaperByIndex("prev") });
            nextItem.connect('activate', () => { this.getWallpaperByIndex("next") });

            this.menu.addMenuItem(this.wallpaperTextPMI);
            this.menu.addMenuItem(this.copyrightTextPMI);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(prevItem);
            this.menu.addMenuItem(nextItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addMenuItem(this.nextRefreshPMI);
            this.menu.addMenuItem(refreshNowPMI);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction(_("Copy image URL to clipboard"), () => Clipboard.get_default().set_text(ClipboardType.CLIPBOARD, bingHost + this.imageData.url));
            this.menu.addAction(_("Open image folder"), () => Util.spawnCommandLine(`nemo ${this.wallpaperDir}`));
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this.menu.addAction(_("Settings"), () => Util.spawnCommandLine("cinnamon-settings applets " + UUID));

            // this.menu.addAction(_("Set background image"), this._settings.get_boolean('set-background'));

            //#endregion
        }, 2000);

        if (this.saveWallpaper)
            this._saveWallpaperToImageFolder();
    },

    on_applet_clicked: function () {
        // Show/Hide the menu.
        this.menu.toggle();
    },

    on_toggle_enableDailyrefreshPSMI: function () {
        if (!this.enableDailyrefreshPSMI.state) {
            this._removeTimeout();
            Utils.log("daily refresh disabled");
        } else {
            this._refresh();
            Utils.log("daily refresh enabled");
        }
        this._settings.setValue("dailyRefreshState", this.enableDailyrefreshPSMI.state);
    },

    _updateNextRefreshTextPopup: function () {
        if (!this.dailyRefreshState) {
            this.refreshduetext = "Refresh deactivated";
        } else {
            _nextRefresh = Utils.friendly_time_diff(_lastRefreshTime, true);

            this.refreshduetext =
                _("Next refresh") + ": " + (_lastRefreshTime ? _lastRefreshTime.format("%Y-%m-%d %X") : '-') +
                " (" + _nextRefresh + ")";
        }

        if (this.nextRefreshPMI) {
            this.nextRefreshPMI.setLabel(this.refreshduetext);
        }
    },

    setWallpaperDirectory: function (path) {
        Utils.log(path);
        this.wallpaperDir = Utils.formatFolderName(path);

        if (this.saveWallpaper)
            this._saveWallpaperToImageFolder();
    },

    _saveWallpaperToImageFolder: async function () {
        let dir = Gio.file_new_for_path(`${this.wallpaperDir}`);

        if (!dir.query_exists(null))
            dir.make_directory(null);

        await Utils.delay(5000); // we wait 5s to be sure that the download of the current wallpaper is done
        const currentDate = this.imageData.fullstartdate;

        let imagePath = GLib.build_filenamev([this.wallpaperDir, `BingWallpaper_${currentDate}.jpg`]);
        imagePath = Gio.file_new_for_path(imagePath);

        if (!imagePath.query_exists(null)) {
            const source = Gio.file_new_for_path(this.wallpaperPath);

            try {
                source.copy(imagePath, Gio.FileCopyFlags.NONE, null, null);
            } catch (error) {
                Utils.log("error _saveWallpaperToImageFolder: " + error);
            }
        }
    },

    getWallpaperByIndex: function (sens) {
        switch (sens) {
            case "next":
                if (_idxWallpaper > 0)
                    _idxWallpaper -= 1;
                break;
            case "prev":

                if (_idxWallpaper < 8)
                    _idxWallpaper += 1;
                break;
            default:
                _idxWallpaper = 0;
                break;
        }

        this._downloadMetaData();
        this._refresh();
    },

    //#region Timeout
    _refresh: function () {
        Utils.log(`Beginning refresh`);
        this._getMetaData();
        if (this.dailyRefreshState) {
            this._setTimeout(this.refreshInterval);
        } else {
            this._removeTimeout();
        }
        this._updateNextRefreshTextPopup();
    },

    _removeTimeout: function () {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    },

    _setTimeout: function (minutes) {
        /** Cancel current timeout in event of an error and try again shortly */
        this._removeTimeout();
        Utils.log(`Setting timeout (${minutes}min)`);
        this._timeout = Mainloop.timeout_add_seconds(minutes * 60, Lang.bind(this, this._refresh));

        _lastRefreshTime = GLib.DateTime.new_now_local().add_seconds(minutes * 60);
    },

    destroy: function () {
        this._removeTimeout();
    },
    on_applet_removed_from_panel() {
        this._removeTimeout();
    },

    //#region Metadata and wallpaper download
    _getMetaData: function () {

        /** Check for local metadata  */
        try {
            const jsonString = GLib.file_get_contents(this.metaDataPath)[1];
            const json = JSON.parse(jsonString);

            this.imageData = json.images[0];
            this.set_applet_tooltip(this.imageData.copyright);

            const copyrightsSplit = Utils.splitCopyrightsText(this.imageData.copyright);
            this.wallpaperTextPMI.setLabel(copyrightsSplit[0]);
            this.copyrightTextPMI.setLabel(copyrightsSplit[1]);
            Utils.log(`Got image url from local file : ${this.imageData.url}`);

            /** See if this data is current */
            const start_date = GLib.DateTime.new(
                GLib.TimeZone.new_utc(),
                this.imageData.fullstartdate.substring(0, 4),
                this.imageData.fullstartdate.substring(4, 6),
                this.imageData.fullstartdate.substring(6, 8),
                this.imageData.fullstartdate.substring(8, 10),
                this.imageData.fullstartdate.substring(10, 12),
                0
            );
            const end_date = start_date.add_days(1);
            const now = GLib.DateTime.new_now_utc();

            if (now.to_unix() < end_date.to_unix()) {
                Utils.log('metadata up to date');

                // Look for image file, check this is up to date
                let image_file = Gio.file_new_for_path(this.wallpaperPath);

                if (image_file.query_exists(null)) {

                    let image_file_info = image_file.query_info('*', Gio.FileQueryInfoFlags.NONE, null);
                    let image_file_size = image_file_info.get_size();
                    let image_file_mod_secs = image_file_info.get_modification_time().tv_sec;

                    if ((image_file_mod_secs > end_date.to_unix()) || !image_file_size) { // Is the image old, or empty?
                        this._downloadImage();
                    } else {
                        Utils.log("image appears up to date");
                    }
                } else {
                    Utils.log("No image file found");
                    this._downloadImage();
                }
            }
            else {
                Utils.log('metadata is old, requesting new...');
                this._downloadMetaData();
            }
        } catch (err) {
            Utils.log(`Unable to get local metadata ${err}`);
            /** File does not exist or there was an error processing it */
            this._downloadMetaData();
        }
    },

    _downloadMetaData: function () {
        const process_result = data => {

            // Write to meta data file
            let gFile = Gio.file_new_for_path(this.metaDataPath);
            let fStream = gFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
            let toWrite = data.length;
            while (toWrite > 0)
                toWrite -= fStream.write(data, null);
            fStream.close(null);

            const json = JSON.parse(data);
            this.imageData = json.images[0];
            this.set_applet_tooltip(this.imageData.copyright);

            const copyrightsSplit = Utils.splitCopyrightsText(this.imageData.copyright);
            this.wallpaperTextPMI.setLabel(copyrightsSplit[0]);
            this.copyrightTextPMI.setLabel(copyrightsSplit[1]);
            Utils.log(`Got image url from download: ${this.imageData.url}`);

            this._downloadImage();
        };

        const bingRequestPath = '/HPImageArchive.aspx?format=js&idx=' + _idxWallpaper + '&n=1&mbl=1';

        // Retrieve json metadata, either from local file or remote
        _httpSession.queryMetada(bingHost + bingRequestPath, process_result, () => this._setTimeout(1));
    },

    _downloadImage: function () {
        const url = `${bingHost}${this.imageData.url}`;
        const regex = /_\d+x\d+./gm;
        const urlUHD = url.replace(regex, `_UHD.`);

        _httpSession.downloadImageFromUrl(urlUHD, this.wallpaperPath, this._setBackground, () => this._setTimeout(1));
    },

    _setBackground: function () {
        let gSetting = new Gio.Settings({ schema: 'org.cinnamon.desktop.background' });
        const uri = 'file://' + this.wallpaperPath;
        gSetting.set_string('picture-uri', uri);
        gSetting.set_string('picture-options', 'zoom');
        Gio.Settings.sync();
        gSetting.apply();
    },
    //#endregion

    // #region -- Settings --

    _bindSettings: function (metadata, orientation, panel_height, instance_id) {

        // Reference: https://github.com/linuxmint/Cinnamon/wiki/Applet,-Desklet-and-Extension-Settings-Reference

        // Create the settings object
        // In this case we use another way to get the uuid, the metadata object.
        this._settings = new Settings.AppletSettings(this, metadata.uuid, instance_id);

        Object.keys(SettingsMap).forEach((key) => {
            this._settings.bindProperty(
                Settings.BindingDirection.IN,
                key,
                key,
                function () {
                    this._property_changed(key);
                },
                null
            );
        });

        // Tell the settings provider we want to bind one of our settings keys to an applet property.
        // this._settings.bindProperty(Settings.BindingDirection.IN,   // The binding direction - IN means we only listen for changes from this applet.
        //     'settings-test-scale',                     // The key of the UI control associated with the setting in the "settings-schema.json" file.
        //     'settings-test-scale',                     // Name that is going to be used as the applet property.
        //     this.onSettingsChanged,                    // Method to be called when the setting value changes.
        //     null                                       // Optional - it can be left off entirely, or used to pass any extra object to the callback if desired.
        // );
    },

    _property_changed: function (key) {
        const val = this._settings.getValue(key);

        switch (key) {
            case "wallpaperDir":
                this.setWallpaperDirectory(val);
                break;
            case "saveWallpaper":
                if (this.saveWallpaper)
                    this._saveWallpaperToImageFolder();
                break;
            case "refreshInterval":
                this._refresh();
                break;
            case "dailyRefreshState":
                if (!val) {
                    this._removeTimeout();
                    Utils.log("daily refresh disabled");
                } else {
                    this._refresh();
                    Utils.log("daily refresh enabled");
                }
                break;
            default:
                Utils.log("no property changed");
                break;
        }

        SettingsMap[key] = this[key];
    },
    //#endregion
};


function main(metadata, orientation, panelHeight, instanceId) {
    return new BingWallpaperApplet(metadata, orientation, panelHeight, instanceId);
}
