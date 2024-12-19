import fetch from 'node-fetch';

export const moveCamera = async (direction: { pan: number, tilt?: number }, set: any) => {
  const merekCamera = process.env.MEREK_CAMERA;
  const urlCamera = process.env.CAMERA_URL;
  let xmlData = '';
  let url = '';

  if (merekCamera === 'hikvision') {
    xmlData = `<PTZData version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
                <pan> ${direction.pan} </pan>
                ${direction.tilt ? `<tilt> ${direction.tilt} </tilt>` : ''}
                <Momentary>
                  <duration> 1000 </duration>
                </Momentary>
              </PTZData>`;
    url = `${urlCamera}/ISAPI/PTZCtrl/channels/1/momentary`;
  } else if (merekCamera === 'tiandy') {
    xmlData = `<PTZData>
                <pan>${direction.pan}</pan>
                <tilt>${direction.tilt || 0}</tilt>
                <zoom/>
              </PTZData>`;
    url = `${urlCamera}/ISAPI/PTZCtrl/channels/1/continuous`;

    const myHeaders = new Headers();
    myHeaders.append("Accept", "application/xml, text/xml, */*; q=0.01");
    myHeaders.append("Accept-Language", "en-US,en;q=0.9,id-ID;q=0.8,id;q=0.7");
    myHeaders.append("Cache-Control", "max-age=0");
    myHeaders.append("Connection", "keep-alive");
    myHeaders.append("Content-Type", "application/xml; charset=UTF-8");
    myHeaders.append("Cookie", "live_port=3002; user=admin; V2_Session_331a1bf7=054o6c9fdTGqdsKgEBvtp6X1qAnRtAY8");
    myHeaders.append("HttpSession", "054o6c9fdTGqdsKgEBvtp6X1qAnRtAY8");
    myHeaders.append("If-Modified-Since", "0");
    myHeaders.append("Origin", "http://192.168.18.65");
    myHeaders.append("Referer", "http://192.168.18.65/?t=8216619344");
    myHeaders.append("User-Agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");
    myHeaders.append("X-Requested-With", "XMLHttpRequest");

    const response = await fetch(url, {
      method: 'PUT',
      headers: myHeaders,
      body: xmlData
    });

    if (!response.ok) {
      url = `${urlCamera}/CGI/PTZCtrl/channels/1/continuous`;
      const cgiResponse = await fetch(url, {
        method: 'PUT',
        headers: myHeaders,
        body: xmlData
      });

      if (!cgiResponse.ok) {
        set.status = cgiResponse.status;
        return { success: false, message: `Request failed with status code: ${cgiResponse.status}` };
      }
    }

    const stopXmlData = '<PTZData><pan>0</pan><tilt>0</tilt><zoom/></PTZData>';
    setTimeout(async () => {
      await fetch(url, {
        method: 'PUT',
        headers: myHeaders,
        body: stopXmlData
      });
    }, 500);
  } else {
    set.status = 400;
    return { success: false, message: 'Kamera tidak ditemukan atau tidak didukung.' };
  }

  set.headers = { 'Content-Type': 'application/json' };
  return { success: true };
};
