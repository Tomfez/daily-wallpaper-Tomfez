const GLib = imports.gi.GLib;

class Utils {

    constructor() { }

    /**
     * 
     * @param {GLib.DateTime} time The DateTime object to compare
     * @param {boolean} short True to display short unit of time, false to display long unit of time
     * @returns 
     */
    friendly_time_diff(time, short = true) {
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