Source.prototype = {
    _init: function (source) {
        this.url = source;
        this.metadata = "";
        this.copyright = "";

        fetchWikiData('Tassili n\'Ajjer').then(results => {
            console.log(results);
        });
    },

    fetchWikiData: async function (query) {
        // const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
        const CommonsImageURLbase = "https://commons.wikimedia.org/w/api.php?format=json&action=query&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=ImageDescription|Artist|LicenseUrl|LicenseShortName&titles=";


        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Erreur lors de la récupération des données');
            }
            const data = await response.json();
            return data.query.search;
        } catch (error) {
            console.error('Erreur:', error);
        }
    }
}

function Source(source) {
    this._init(source);
}