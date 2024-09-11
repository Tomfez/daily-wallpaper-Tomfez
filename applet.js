const { Utils } = require("./utils");
const { Source } = require("./source");

const Applet = imports.ui.applet;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const { Clipboard, ClipboardType } = imports.gi.St;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu; // /usr/share/cinnamon/js/ui/popupMenu.js
const Settings = imports.ui.settings;   // /usr/share/cinnamon/js/ui/settings.js
const Util = imports.misc.util;
const St = imports.gi.St;
const SignalManager = imports.misc.signalManager;
const Clutter = imports.gi.Clutter;

const currentDateTime = GLib.DateTime.new_now_local();
const UUID = "bing-wallpaper@Tomfez";

let _lastRefreshTime;
let _nextRefresh;
let _idxWallpaper = 0;

function BingWallpaperApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

BingWallpaperApplet.prototype = {
    __proto__: Applet.IconApplet.prototype,

    //#region Init
    _init: function (metadata, orientation, panel_height, instance_id) {
        // Generic Setup
        Applet.IconApplet.prototype._init.call(this, orientation, panel_height, instance_id);
        this.set_applet_icon_symbolic_name("bing-wallpaper");
        this.set_applet_tooltip('Bing Desktop Wallpaper');

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
        this.prev_next_box = new St.BoxLayout(
            {
                style_class: "calendar-events-no-events-box",
                vertical: false,
                visible: true,
                // height: 30,
                width: 300,
                x_align: Clutter.ActorAlign.CENTER,
                // y_align: Clutter.ActorAlign.CENTER,
                // y_expand: true
            }
        );

        // this.no_events_button = new St.Button(
        //     {
        //         style_class: "calendar-events-no-events-button",
        //         label: "practise",
        //         reactive: GLib.find_program_in_path("gnome-calendar")
        //     }
        // );

        // #region Previous button
        this.previous_button = new St.Button({ style_class: "button", width: 150 });

        this.previous_button.connect('clicked', Lang.bind(this, () => {
            this.getWallpaperByIndex("prev");
        }));
        this.prev_next_box.add_actor(this.previous_button);

        let button_inner_box = new St.BoxLayout({ vertical: false });
        let previous_label = new St.Label(
            {
                style_class: "popup-menu-item",
                text: _("Previous"),
                y_align: Clutter.ActorAlign.CENTER
            }
        );

        let previous_icon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'go-previous-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                // icon_size: 24
            }
        );
        //#endregion

        this.middle_box = new St.BoxLayout(
            {
                vertical: false,
                visible: true,
                // height: 30,
                width: 10
            }
        );
this.prev_next_box.add_actor(this.middle_box);

        //#region Next button
        this.next_button = new St.Button({ style_class: "button", width: 150 });

        this.next_button.connect('clicked', Lang.bind(this, () => {
            this.getWallpaperByIndex("next");
        }));
        this.prev_next_box.add_actor(this.next_button);

        let next_button = new St.BoxLayout({ vertical: false });
        let next_label = new St.Label(
            {
                style_class: "popup-menu-item",
                text: _("Next"),
                y_align: Clutter.ActorAlign.CENTER
            }
        );

        let next_icon = new St.Icon(
            {
                style_class: "popup-menu-icon",
                icon_name: 'go-next-symbolic',
                icon_type: St.IconType.SYMBOLIC,
                // icon_size: 24
            }
        );
        //#endregion

        button_inner_box.add_actor(previous_icon);
        button_inner_box.add_actor(previous_label);
        next_button.add_actor(next_icon);
        next_button.add_actor(next_label);

        this.previous_button.add_actor(button_inner_box);
        this.next_button.add_actor(next_button);
        this.prev_next_box.add_actor(this.previous_button);

        this.wallpaperTextPMI = new PopupMenu.PopupMenuItem("", {
            hover: false,
            style_class: 'copyright-text'
        });

        this.copyrightTextPMI = new PopupMenu.PopupMenuItem("", {
            sensitive: false,
        });

        let wallpaperDateFormatted = currentDateTime.format("%Y-%m-%d");
        let wallpaperDayText = `Bing wallpaper of the day for ${wallpaperDateFormatted}`;
        this.dayOfWallpaperPMI = new PopupMenu.PopupMenuItem(wallpaperDayText, {
            hover: false,
            style_class: 'text-popupmenu'
        });

        this.nextRefreshPMI = new PopupMenu.PopupMenuItem("", { sensitive: false });

        const refreshNowPMI = new PopupMenu.PopupMenuItem(_("Refresh now"));
        refreshNowPMI.connect('activate', Lang.bind(this, this._refresh));

        // const prevItem = new PopupMenu.PopupIconMenuItem(_("Previous"), "go-previous-symbolic", St.IconType.SYMBOLIC, {});
        // const nextItem = new PopupMenu.PopupIconMenuItem(_("Next"), "go-next-symbolic", St.IconType.SYMBOLIC, {});

        // prevItem.connect('activate', () => { this.getWallpaperByIndex("prev") });
        // nextItem.connect('activate', () => { this.getWallpaperByIndex("next") });

        this.menu.addMenuItem(this.wallpaperTextPMI);
        this.menu.addMenuItem(this.copyrightTextPMI);
        this.menu.addMenuItem(this.dayOfWallpaperPMI);
        this.menu.addActor(this.prev_next_box);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // this.menu.addMenuItem(prevItem);
        // this.menu.addMenuItem(nextItem);
        // this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this.nextRefreshPMI);
        this.menu.addMenuItem(refreshNowPMI);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_("Copy image URL to clipboard"), () => Clipboard.get_default().set_text(ClipboardType.CLIPBOARD, this.Source.imageURL));
        this.menu.addAction(_("Open image folder"), () => Util.spawnCommandLine(`nemo ${this.wallpaperDir}`));
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addAction(_("Settings"), () => Util.spawnCommandLine("cinnamon-settings applets " + UUID));
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
                    Utils.showDesktopNotification("Bing Desktop Wallpaper", "This is the most recent image.", "dialog-information");
                }
                break;
            case "prev":
                // 7 is the maximum number of days to get the wallpapers
                if (_idxWallpaper < 7) {
                    _idxWallpaper += 1;
                } else if (_idxWallpaper == 7) {
                    Utils.showDesktopNotification("Bing Desktop Wallpaper", "Last image. Unable to get more images.", "dialog-information");
                }
                break;
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
                const rand = Utils.getRandomInt(7);
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
            if (currentDateTime.to_unix() < end_date.to_unix()) {
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
            global.log(data);
            this.set_applet_tooltip(this.Source.copyrights);

            this.wallpaperTextPMI.setLabel(this.Source.description);
            this.copyrightTextPMI.setLabel(this.Source.copyrightsAutor);

            const wallpaperDate = currentDateTime.add_days(-_idxWallpaper).format("%Y-%m-%d");
            this.dayOfWallpaperPMI.setLabel(`Wallpaper of the day at ${this.currentSource} for ${wallpaperDate}`);

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
    return new BingWallpaperApplet(metadata, orientation, panelHeight, instanceId);
}
