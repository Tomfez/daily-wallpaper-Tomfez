const { Utils } = require("./utils");
const { Source } = require("./source");

const Applet = imports.ui.applet;
const { Clipboard, ClipboardType } = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu; // /usr/share/cinnamon/js/ui/popupMenu.js
const Settings = imports.ui.settings;   // /usr/share/cinnamon/js/ui/settings.js
const St = imports.gi.St;
const Util = imports.misc.util;

const currentDateTime = GLib.DateTime.new_now_local();
const UUID = "daily-wallpaper@Tomfez";
const ICON_SIZE = 24;

let _lastRefreshTime;
let _nextRefresh;
let _idxWallpaper = 0;

function DailyWallpaperApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

DailyWallpaperApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    //#region Init
    _init: function (metadata, orientation, panel_height, instance_id) {
        // Generic Setup
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        this.set_applet_icon_symbolic_name("bing-wallpaper");
        this.set_applet_tooltip('Daily Desktop Wallpaper');

        this._bindSettings(metadata, orientation, panel_height, instance_id);

        global.DEBUG = this.debug;

        // We use this directory to store the current wallpaper and metadata
        const configPath = `${GLib.get_user_config_dir()}/bingwallpaper`;

        const configPathObj = Gio.file_new_for_path(configPath);

        if (!configPathObj.query_exists(null))
            configPathObj.make_directory(null);

        this.wallpaperPath = `${configPath}/wallpaper.jpg`;
        this.metaDataPath = `${configPath}/meta.json`;

        this.Source = new Source(this.currentSource, this.metaDataPath, this.wallpaperPath);

        let file = Gio.file_new_for_path(this.metaDataPath);
        if (!file.query_exists(null))
            file.create(Gio.FileCreateFlags.NONE, null);

        this.getWallpaperDatePreferences();
        this.initMarket();

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.initMenu();

        // Begin refresh loop
        this._refresh();
    },

    initMenu: function () {
        this.wallpaperTextPMI = new PopupMenu.PopupMenuItem("", {
            hover: false,
            style_class: 'copyright-text'
        });

        this.copyrightTextPMI = new PopupMenu.PopupMenuItem("", {
            sensitive: false,
        });

        let wallpaperDateFormatted = currentDateTime.format("%Y-%m-%d");
        let wallpaperDayText = `Daily wallpaper of the day for ${wallpaperDateFormatted}`;
        this.dayOfWallpaperPMI = new PopupMenu.PopupMenuItem(wallpaperDayText, {
            hover: false,
            style_class: 'text-popupmenu'
        });

        this.nextRefreshPMI = new PopupMenu.PopupMenuItem("", { sensitive: false });

        const refreshNowPMI = new PopupMenu.PopupMenuItem(_("Refresh now"));
        refreshNowPMI.connect('activate', Lang.bind(this, this._refresh));

        this.initControlsBox();

        this.menu.addMenuItem(this.wallpaperTextPMI);
        this.menu.addMenuItem(this.copyrightTextPMI);
        this.menu.addMenuItem(this.dayOfWallpaperPMI);
        this.menu.addActor(this.controlsBox);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.nextRefreshPMI);
        this.menu.addMenuItem(refreshNowPMI);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_("Copy image URL to clipboard"), () => Clipboard.get_default().set_text(ClipboardType.CLIPBOARD, this.Source.imageURL));
        this.menu.addAction(_("Open image folder"), () => Util.spawnCommandLine(`nemo ${this.wallpaperDir}`));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_("Settings"), () => Util.spawnCommandLine("cinnamon-settings applets " + UUID));
    },

    initControlsBox: function () {
        this.controlsBox = new St.BoxLayout(
            {
                style_class: "popup-menu-item",
                vertical: false,
                visible: true,
                reactive: true,
                x_align: Clutter.ActorAlign.CENTER
            }
        );

        // #region Previous button
        const prevCtrlBtn = new St.Button({ style_class: "button", width: 75 });
        prevCtrlBtn.connect('clicked', Lang.bind(this, () => this.getWallpaperByIndex("prev")));

        const prevCtrlLayout = new St.BoxLayout({ vertical: false });

        const prevCtrlIcon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'go-previous-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                x_expand: true,
                y_expand: true,
                icon_size: ICON_SIZE
            }
        );

        prevCtrlLayout.add_actor(prevCtrlIcon, { span: 0 });
        prevCtrlBtn.add_actor(prevCtrlLayout);
        //#endregion

        // #region Randomize button
        const randCtrlBtn = new St.Button({ style_class: "button", width: 75 });
        randCtrlBtn.connect('clicked', Lang.bind(this, () => { this.getWallpaperByIndex("rand"); }));

        const randCtrlLayout = new St.BoxLayout({ vertical: false });

        const randCtrlIcon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'media-playlist-shuffle-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                x_expand: true,
                y_expand: true,
                icon_size: ICON_SIZE
            }
        );

        randCtrlLayout.add_actor(randCtrlIcon, { span: 0 });
        randCtrlBtn.add_actor(randCtrlLayout);
        //#endregion

        //#region Next button
        const nextCtrlBtn = new St.Button({ style_class: "button", width: 75 });
        nextCtrlBtn.connect('clicked', Lang.bind(this, () => { this.getWallpaperByIndex("next"); }));

        const nextCtrlLayout = new St.BoxLayout({ vertical: false });

        const nextCtrlIcon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'go-next-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                x_expand: true,
                y_expand: true,
                icon_size: ICON_SIZE
            }
        );

        nextCtrlLayout.add_actor(nextCtrlIcon, { span: 0 });
        nextCtrlBtn.add_actor(nextCtrlLayout);
        //#endregion

        //#region Reset button
        const resetCtrlBtn = new St.Button({ style_class: "button", width: 75 });
        resetCtrlBtn.connect('clicked', Lang.bind(this, () => this.getWallpaperByIndex("reset")));

        const resetCtrlLayout = new St.BoxLayout({ vertical: false });

        const resetCtrlIcon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'go-first-symbolic-rtl',
                icon_type: St.IconType.SYMBOLIC,
                x_expand: true,
                y_expand: true,
                icon_size: ICON_SIZE
            }
        );

        resetCtrlLayout.add_actor(resetCtrlIcon, { span: 0 });
        resetCtrlBtn.add_actor(resetCtrlLayout);
        //#endregion

        // Add all buttons to the main box
        this.controlsBox.add_actor(prevCtrlBtn);
        this.controlsBox.add_actor(randCtrlBtn);
        this.controlsBox.add_actor(nextCtrlBtn);
        this.controlsBox.add_actor(resetCtrlBtn);
    },

    initMarket: function () {
        if (this.market === "auto") {
            const usrLang = Utils.getUserLanguage();
            const options = this._settings.getOptions("market");

            let res = false;
            for (let k in options) {
                if (k === usrLang) {
                    res = true;
                    break;
                }
            }

            // If language not found, we use en-US as default
            if (!res)
                this.market = "en-US"
        }
    },

    on_applet_clicked: function () {
        // Show/Hide the menu.
        this.menu.toggle();
    },

    destroy: function () {
        this._removeTimeout();
    },
    on_applet_removed_from_panel: function () {
        this._removeTimeout();
        this.menu.destroy();
        this._settings.finalize();
    },
    //#endregion

    on_toggle_enableDailyrefreshPSMI: function () {
        if (!this.dailyRefreshState) {
            this._removeTimeout();
            Utils.log("daily refresh disabled");
        } else {
            this._refresh();
            Utils.log("daily refresh enabled");
        }
    },

    _changeCurrentSource: function () {
        this.Source = new Source(this.currentSource, this.metaDataPath, this.wallpaperPath);
    },

    _updateNextRefreshTextPopup: function () {
        _nextRefresh = Utils.friendly_time_diff(_lastRefreshTime, true);

        this.refreshduetext =
            _("Next refresh") + ": " + (_lastRefreshTime ? _lastRefreshTime.format("%Y-%m-%d %X") : '-') +
            " (" + _nextRefresh + ")";

        if (this.nextRefreshPMI) {
            this.nextRefreshPMI.setLabel(this.refreshduetext);
        }
    },

    setWallpaperDirectory: function () {
        Utils.log(this.wallpaperDir);
        this.wallpaperDir = Utils.formatFolderName(this.wallpaperDir);
    },

    _saveWallpaperToImageFolder: function () {
        if (!this.saveWallpaper)
            return;

        let dir = Gio.file_new_for_path(`${this.wallpaperDir}`);

        if (!dir.query_exists(null))
            dir.make_directory(null);

        const filename = this.currentSource + "_" + currentDateTime.add_days(-_idxWallpaper).format("%Y%m%d") + ".jpg";
        let imagePath = Gio.file_new_for_path(this.wallpaperDir + "/" + filename);

        if (!imagePath.query_exists(null)) {
            const source = Gio.file_new_for_path(this.wallpaperPath);

            try {
                source.copy(imagePath, Gio.FileCopyFlags.NONE, null, null);
            } catch (error) {
                Utils.log("error _saveWallpaperToImageFolder: " + error);
            }
        }
    },

    getWallpaperByIndex: function (navigate) {
        switch (navigate) {
            case "next":
                if (_idxWallpaper > 0) {
                    _idxWallpaper -= 1;
                } else if (_idxWallpaper == 0) {
                    Utils.showDesktopNotification("Daily Desktop Wallpaper", "This is the most recent image.", "dialog-information");
                }
                break;
            case "prev":
                // 7 is the maximum number of days to get the wallpapers
                if (_idxWallpaper < 7) {
                    _idxWallpaper += 1;
                } else if (_idxWallpaper == 7) {
                    Utils.showDesktopNotification("Daily Desktop Wallpaper", "Last image. Unable to get more images.", "dialog-information");
                }
                break;
            case "rand":
                const rand = Utils.getRandomInt(7);
                _idxWallpaper = rand;
                break;
            case "reset":
            default:
                _idxWallpaper = 0;
                break;
        }

        this._downloadMetaData();
        this._setTimeout(this.refreshInterval);
    },

    getWallpaperDatePreferences: function () {
        switch (this.selectedImagePreferences) {
            case 1:
                let rand = _idxWallpaper;

                while (rand === _idxWallpaper) {
                    rand = Utils.getRandomInt(7);
                }

                _idxWallpaper = rand;
                break;
            default:
            case 0:
                _idxWallpaper = 0;
                break;
        }
    },

    //#region Timeout
    _refresh: function () {
        if (this.dailyRefreshState) {
            Utils.log(`Beginning refresh`);
            this._setTimeout(this.refreshInterval);
            this._getMetaData();
        } else {
            Utils.log("Timeout removed");
            this._removeTimeout();
            this.nextRefreshPMI.setLabel("Refresh deactivated");

            this.Source.getMetaDataLocal();

            this.wallpaperTextPMI.setLabel(this.Source.description);
            this.copyrightTextPMI.setLabel(this.Source.copyrightsAutor);
            this.set_applet_tooltip(this.Source.copyrights);
        }
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
        // Utils.log(`Setting timeout (${minutes}min)`);
        this._timeout = Mainloop.timeout_add_seconds(minutes * 60, Lang.bind(this, this._refresh));

        _lastRefreshTime = GLib.DateTime.new_now_local().add_seconds(minutes * 60);
        this._updateNextRefreshTextPopup();
    },
    //#endregion

    //#region Metadata and wallpaper download
    _getMetaData: function () {
        try {
            /** Check for local metadata  */
            if (this.Source.imageData === undefined)
                this.Source.getMetaDataLocal();

            this.set_applet_tooltip(this.Source.copyrights);

            this.wallpaperTextPMI.setLabel(this.Source.description);
            this.copyrightTextPMI.setLabel(this.Source.copyrightsAutor);

            if (this.Source.wallpaperDate === undefined)
                this.Source.wallpaperDate = currentDateTime.add_days(-_idxWallpaper);

            const end_date = GLib.DateTime.new(
                GLib.TimeZone.new_utc(),
                this.Source.wallpaperDate.get_year(),
                this.Source.wallpaperDate.get_month(),
                this.Source.wallpaperDate.get_day_of_month(),
                23,
                59,
                59
            );

            /** See if this data is current */
            if ((currentDateTime.to_unix() < end_date.to_unix()) && this.selectedImagePreferences === 0) {
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
            } else {
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
        const write_file = data => {
            this.set_applet_tooltip(this.Source.copyrights);

            this.wallpaperTextPMI.setLabel(this.Source.description);
            this.copyrightTextPMI.setLabel(this.Source.copyrightsAutor);

            const wallpaperDate = currentDateTime.add_days(-_idxWallpaper).format("%Y-%m-%d");
            const source = this.currentSource.charAt(0).toUpperCase() + this.currentSource.slice(1);
            this.dayOfWallpaperPMI.setLabel(`Wallpaper of the day at ${source} for ${wallpaperDate}`);

            this._downloadImage();
        };

        let url = "";
        if (this.currentSource === "bing") {
            url = `/HPImageArchive.aspx?format=js&idx=${_idxWallpaper}&n=1&mbl=1&mkt=${this.market}`;
        } else if (this.currentSource === "wikimedia") {
            const newDate = currentDateTime.add_days(-_idxWallpaper);
            url = newDate.format("%Y/%m/%d");

            this.Source.wallpaperDate = newDate;
        }

        this.Source.getMetaData(url, write_file, () => this._setTimeout(1));
    },

    _downloadImage: function () {
        const process_result = () => {
            this._saveWallpaperToImageFolder();
            this._setBackground();
        };
        this.Source.downloadImage(process_result, () => this._setTimeout(1));
    },

    _setBackground: function () {
        Utils.log("setting background");
        let gSetting = new Gio.Settings({ schema: 'org.cinnamon.desktop.background' });
        const uri = 'file://' + this.wallpaperPath;
        gSetting.set_string('picture-uri', uri);
        gSetting.set_string('picture-options', this.pictureOptions);
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
        this._settings.bindProperty(null, "wallpaperDir", "wallpaperDir", this.setWallpaperDirectory, null);
        this._settings.bindProperty(null, "saveWallpaper", "saveWallpaper", () => this._saveWallpaperToImageFolder, null);
        this._settings.bindProperty(null, "refreshInterval", "refreshInterval", this._refresh, null);
        this._settings.bindProperty(null, "dailyRefreshState", "dailyRefreshState", this.on_toggle_enableDailyrefreshPSMI, null);
        this._settings.bindProperty(null, "selectedImagePreferences", "selectedImagePreferences", null, null);
        this._settings.bindProperty(null, "market", "market", null, null);
        this._settings.bindProperty(null, "image-aspect-options", "pictureOptions", this._setBackground, null);
        this._settings.bindProperty(null, 'debugToggle', 'debug', (val) => { global.DEBUG = val; }, null);
        this._settings.bindProperty(null, 'currentSource', 'currentSource', this._changeCurrentSource, null);

        // Tell the settings provider we want to bind one of our settings keys to an applet property.
        // this._settings.bindProperty(Settings.BindingDirection.IN,   // The binding direction - IN means we only listen for changes from this applet.
        //     'settings-test-scale',                     // The key of the UI control associated with the setting in the "settings-schema.json" file.
        //     'settings-test-scale',                     // Name that is going to be used as the applet property.
        //     this.onSettingsChanged,                    // Method to be called when the setting value changes.
        //     null                                       // Optional - it can be left off entirely, or used to pass any extra object to the callback if desired.
        // );
    },
    //#endregion
};


function main(metadata, orientation, panelHeight, instanceId) {
    return new DailyWallpaperApplet(metadata, orientation, panelHeight, instanceId);
}
