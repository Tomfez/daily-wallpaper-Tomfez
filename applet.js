const { Utils } = require("./utils");

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

const currentDateFormatted = GLib.DateTime.new_now_utc().format("%Y-%m-%d");
const UUID = "bing-wallpaper@Tomfez";
const logging = true;
let SettingsMap = {
    wallpaperDir: "Wallpaper path",
    saveWallpaper: false,
    refreshInterval: 300
};

let _lastRefreshTime;
let _nextRefresh;
let _httpSession;
if (Soup.MAJOR_VERSION == 2) {
    _httpSession = new Soup.SessionAsync();
    Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());
} else { //version 3
    _httpSession = new Soup.Session();
}

const bingHost = 'https://www.bing.com';
const bingRequestPath = '/HPImageArchive.aspx?format=js&idx=0&n=1&mbl=1';

function log(message) {
    if (logging) {

        if (typeof message === 'object' && !Array.isArray(message) && message !== null) {
            const objectJson = JSON.stringify(message);
            global.log(objectJson);
        } else {
            global.log(`[bing-wallpaper@tom.dev]: ${message}`);
        }
    }
}

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

        // Path to store data in
        if (!this.wallpaperDir) {
            this.wallpaperDir = `${GLib.get_user_config_dir()}/bingwallpaper`;
        }

        this.wallpaperPath = `${this.wallpaperDir}/BingWallpaper.jpg`;
        this.metaDataPath = `${this.wallpaperDir}/meta.json`;

        // Begin refresh loop
        SettingsMap["refreshInterval"] = this._settings.getValue("refreshInterval");
        this._refresh();

        // #region -- Popup menu --

        // Create a popup menu
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this.nextRefreshPMI = new PopupMenu.PopupMenuItem(this.refreshduetext, {
            hover: false,
            style_class: 'text-popupmenu'
        });
        this.menu.addMenuItem(this.nextRefreshPMI, 0);

        const refreshNowPMI = new PopupMenu.PopupMenuItem(_("Refresh now"));
        refreshNowPMI.connect('activate', Lang.bind(this, function () { this._refresh() }));
        this.menu.addMenuItem(refreshNowPMI, 1);

        const wallpaperTodayTextPMI = new PopupMenu.PopupMenuItem(`Bing wallpaper of the day for ${currentDateFormatted}`, {
            hover: false,
            style_class: 'text-popupmenu'
        });
        this.menu.addMenuItem(wallpaperTodayTextPMI, 2);

        const copyrightTextPMI = new PopupMenu.PopupMenuItem(this.imageData.copyright, {
            hover: false,
            style_class: 'text-popupmenu'
        });

        this.menu.addMenuItem(copyrightTextPMI, 3);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem(), 4);

        // Create and add a switch to the context menu.
        this.enableDailyrefreshPSMI = new PopupMenu.PopupSwitchMenuItem(_("Enable daily refresh"), false);
        this.menu.addMenuItem(this.enableDailyrefreshPSMI, 5);

        // Connect the toggle event of the switch to its callback.
        this.enableDailyrefreshPSMI.connect('toggled', Lang.bind(this, this.on_toggle_enableDailyrefreshPSMI));

        const copyURLClipboardPMI = new PopupMenu.PopupMenuItem(_("Copy image URL to clipboard"));
        copyURLClipboardPMI.connect('activate', Lang.bind(this, function () { this._copyURLToClipboard() }));
        this.menu.addMenuItem(copyURLClipboardPMI, 6);

        // First argument is the text of the menu element, the second a callback function to execute when the element is clicked.
        this.menu.addAction(_("Settings"), function () {
            Util.spawnCommandLine("cinnamon-settings applets " + UUID);
        });

        // this.menu.addAction(_("Set background image"), this._settings.get_boolean('set-background'));

        //#endregion

        if (this.saveWallpaper)
            this._saveWallpaperToImageFolder();

        log(SettingsMap);
    },

    on_applet_clicked: function () {
        // Show/Hide the menu.
        this.menu.toggle();
    },

    on_toggle_enableDailyrefreshPSMI: function () {
        if (!this.enableDailyrefreshPSMI.state) {
            this._removeTimeout();
            log("daily refresh disabled");
        } else {
            this._refresh();
            log("daily refresh enabled");
        }
    },

    _updateNextRefreshTextPopup: function () {
        if (this.nextRefreshPMI) {
            let refreshDue = new Utils();
            _nextRefresh = refreshDue.friendly_time_diff(_lastRefreshTime, 86400);//.to_local();

            this.refreshduetext =
                _("Next refresh") + ": " + (_lastRefreshTime ? _lastRefreshTime.format("%Y-%m-%d %X") : '-') +
                " (" + _nextRefresh + ")";

            this.nextRefreshPMI.setLabel(this.refreshduetext);
        } else {
            this.refreshduetext = "Next refresh: now";
        }
    },

    _copyURLToClipboard: function () {
        Clipboard.get_default().set_text(ClipboardType.CLIPBOARD, bingHost + this.imageData.url);
    },

    _refresh: function () {
        log(`Beginning refresh`);
        this._getMetaData();
        // global.log(SettingsMap["refreshInterval"]);
        this._setTimeout(SettingsMap["refreshInterval"]);
        this._updateNextRefreshTextPopup();
    },

    _removeTimeout: function () {
        if (this._timeout) {
            Mainloop.source_remove(this._timeout);
            this._timeout = null;
        }
    },

    _setTimeout: function (seconds) {
        /** Cancel current timeout in event of an error and try again shortly */
        this._removeTimeout();
        log(`Setting timeout (${seconds}s)`);
        this._timeout = Mainloop.timeout_add_seconds(seconds, Lang.bind(this, this._refresh));
        // SettingsMap["refreshInterval"] = seconds;
        // _lastRefreshTime = new Date();
        _lastRefreshTime = GLib.DateTime.new_now_local().add_seconds(seconds);
    },

    destroy: function () {
        this._removeTimeout();
    },
    on_applet_removed_from_panel() {
        this._removeTimeout();
    },

    //#region Download image and apply as background
    _getMetaData: function () {

        /** Check for local metadata  */
        try {
            const jsonString = GLib.file_get_contents(this.metaDataPath)[1];
            const json = JSON.parse(jsonString);

            this.imageData = json.images[0];
            this.set_applet_tooltip(this.imageData.copyright);
            log(`Got image url from local file : ${this.imageData.url}`);

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
                log('metadata up to date');

                // Look for image file, check this is up to date
                let image_file = Gio.file_new_for_path(this.wallpaperPath);

                if (image_file.query_exists(null)) {

                    let image_file_info = image_file.query_info('*', Gio.FileQueryInfoFlags.NONE, null);
                    let image_file_size = image_file_info.get_size();
                    let image_file_mod_secs = image_file_info.get_modification_time().tv_sec;

                    if ((image_file_mod_secs > end_date.to_unix()) || !image_file_size) { // Is the image old, or empty?
                        this._downloadImage();

                    } else {
                        log("image appears up to date");
                    }

                } else {
                    log("No image file found");
                    this._downloadImage();
                }
            }
            else {
                log('metadata is old, requesting new...');
                this._downloadMetaData();
            }
        } catch (err) {
            log(`Unable to get local metadata ${err}`);
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
            log(`Got image url from download: ${this.imageData.url}`);

            this._downloadImage();
        };

        // Retrieve json metadata, either from local file or remote
        let request = Soup.Message.new('GET', `${bingHost}${bingRequestPath}`);
        if (Soup.MAJOR_VERSION === 2) {
            _httpSession.queue_message(request, (_httpSession, message) => {
                if (message.status_code === 200) {
                    process_result(message.response_body.data);
                } else {
                    log(`Failed to acquire image metadata (${message.status_code})`);
                    this._setTimeout(60)  // Try again
                }
            });
        } else { //version 3
            _httpSession.send_and_read_async(request, Soup.MessagePriority.NORMAL, null, (_httpSession, message) => {
                if (request.get_status() === 200) {
                    const bytes = _httpSession.send_and_read_finish(message);
                    process_result(ByteArray.toString(bytes.get_data()));
                } else {
                    log(`Failed to acquire image metadata (${request.get_status()})`);
                    this._setTimeout(60)  // Try again
                }
            });
        }
    },

    _downloadImage: function () {

        log('downloading new image');
        const url = `${bingHost}${this.imageData.url}`;
        const regex = /_\d+x\d+./gm;
        const urlUHD = url.replace(regex, `_UHD.`);
        let gFile = Gio.file_new_for_path(this.wallpaperPath);

        // open the file
        let fStream = gFile.replace(null, false, Gio.FileCreateFlags.NONE, null);

        // create a http message
        let request = Soup.Message.new('GET', urlUHD);

        // keep track of total bytes written
        let bytesTotal = 0;

        if (Soup.MAJOR_VERSION === 2) {
            // got_chunk event
            request.connect('got_chunk', function (message, chunk) {
                if (message.status_code === 200) { // only save the data we want, not content of 301 redirect page
                    bytesTotal += fStream.write(chunk.get_data(), null);
                }
            });

            // queue the http request
            _httpSession.queue_message(request, (httpSession, message) => {
                // request completed
                fStream.close(null);
                const contentLength = message.response_headers.get_content_length();
                if (message.status_code === 200 && contentLength === bytesTotal) {
                    this._setBackground();
                } else {
                    log("Couldn't fetch image from " + urlUHD);
                    gFile.delete(null);
                    this._setTimeout(60)  // Try again
                }
            });
        } else { //version 3
            _httpSession.send_and_read_async(request, Soup.MessagePriority.NORMAL, null, (httpSession, message) => {
                if (request.get_status() === 200) {
                    const bytes = _httpSession.send_and_read_finish(message);
                    if (bytes && bytes.get_size() > 0) {
                        fStream.write(bytes.get_data(), null);
                    }
                    // request completed
                    fStream.close(null);
                    log('Download successful');
                    this._setBackground();
                } else {
                    log("Couldn't fetch image from " + urlUHD);
                    this._setTimeout(60)  // Try again
                }
            });
        }
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
        switch (key) {
            case "wallpaperDir":
                if (this.wallpaperDir.startsWith("file://")) {
                    this.wallpaperDir = this.wallpaperDir.slice("file://".length);
                }

                global.log("new wallpaperDir: " + this.wallpaperDir);
                break;

            case "saveWallpaper":
                this.saveWallpaper = this._settings.getValue(key);
                global.log("this.saveWallpaperr: " + this.saveWallpaper);

                if (this.saveWallpaper)
                    this._saveWallpaperToImageFolder();
                break;
            case "refreshInterval":
                const newTimeout = this._settings.getValue(key);
                global.log(newTimeout);
                this._setTimeout(newTimeout);
                break;
            default:
                global.log("no property changed");
                break;
        }

        // if (SettingsMap[key] !== this[key]) {
        //     this._start_applet();
        // }
        SettingsMap[key] = this[key];
    },

    _saveWallpaperToImageFolder: function () {
        const picturesDir = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
        let dir = Gio.file_new_for_path(`${picturesDir}/BingWallpapers`);

        if (!dir.query_exists(null))
            dir.make_directory(null);

        const currentDate = new Date();

        const dateFormated = currentDate.toISOString().split('T')[0].replaceAll('-', '')

        let imagePath = GLib.build_filenamev([picturesDir, `BingWallpapers/BingWallpaper_${dateFormated}.jpg`]);

        imagePath = Gio.file_new_for_path(imagePath);

        if (!imagePath.query_exists(null)) {
            //Copy the file to Pictures folder

            const source = Gio.file_new_for_path(this.wallpaperPath);

            try {
                source.copy(imagePath, Gio.FileCopyFlags.NONE, null, null);

            } catch (error) {
                global.log("error: " + error);
            }
        }
    }
    //#endregion
};


function main(metadata, orientation, panelHeight, instanceId) {
    return new BingWallpaperApplet(metadata, orientation, panelHeight, instanceId);
}
