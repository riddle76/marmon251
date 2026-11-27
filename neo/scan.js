const scanCorners = ['Πάνω αριστερά', 'Πάνω δεξιά', 'Κάτω δεξιά', 'Κάτω αριστερά'];

function scanEditorMarkup() {
    const corners = scanCorners.map((name, index) =>
        '<button type="button" class="scan-corner" data-corner="' + index + '" aria-label="' + name + '"></button>').join('');
    return '<fieldset class="note-photo"><legend>Απόδειξη σε PDF</legend><div class="row">' +
        '<input id="scan-camera" type="file" accept="image/*" capture="environment" class="visually-hidden">' +
        '<label class="photo-action" for="scan-camera">Σάρωση απόδειξης</label>' +
        '<input id="scan-file" type="file" accept="image/*" class="visually-hidden">' +
        '<label class="photo-action" for="scan-file">Εικόνα από συλλογή</label></div>' +
        '<p id="scan-status" class="muted" role="status"></p>' +
        '<div id="scan-adjust" hidden><p class="muted">Σύρε τις 4 γωνίες στις άκρες της απόδειξης. Με πληκτρολόγιο χρησιμοποίησε τα βέλη.</p>' +
        '<div class="scan-stage"><canvas aria-label="Εικόνα απόδειξης"></canvas>' + corners + '</div>' +
        '<button type="button" id="create-scan-pdf" class="primary wide">Δημιουργία PDF</button><button type="button" id="cancel-scan" class="wide">Ακύρωση περικοπής</button></div>' +
        '<button type="button" id="clear-scan" hidden>Αφαίρεση PDF</button></fieldset>';
}

function validScanPdf(value) {
    return typeof value === 'string' && /^data:application\/pdf;base64,JVBERi0[A-Za-z0-9+/=]+$/.test(value);
}

function setupReceiptScan(form, savedPdf) {
    const scan = { value: validScanPdf(savedPdf) ? savedPdf : '', busy: false, pending: false };
    const area = form.querySelector('#scan-adjust');
    const stage = area.querySelector('.scan-stage');
    const canvas = stage.querySelector('canvas');
    const context = canvas.getContext('2d');
    const handles = [...stage.querySelectorAll('[data-corner]')];
    const status = form.querySelector('#scan-status');
    const clear = form.querySelector('#clear-scan');
    const create = form.querySelector('#create-scan-pdf');
    const pickers = form.querySelectorAll('#scan-camera, #scan-file');
    let source;
    let corners = [];
    let selection = 0;

    function draw() {
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        context.beginPath();
        for (const [i, point] of corners.entries()) {
            const x = point.x * canvas.width, y = point.y * canvas.height;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
            handles[i].style.left = point.x * 100 + '%';
            handles[i].style.top = point.y * 100 + '%';
        }
        context.closePath();
        context.lineWidth = Math.max(3, canvas.width / 110);
        context.strokeStyle = '#241644';
        context.stroke();
        context.lineWidth /= 2;
        context.strokeStyle = '#fff';
        context.stroke();
    }

    function move(index, x, y) {
        const clamp = value => Math.max(0, Math.min(1, value));
        corners[index] = { x: clamp(x), y: clamp(y) };
        draw();
    }

    handles.forEach((handle, index) => {
        let drag;
        handle.onpointerdown = event => {
            if (event.button !== 0 || drag) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: corners[index] };
            handle.setPointerCapture(event.pointerId);
        };
        handle.onpointermove = event => {
            if (drag?.id !== event.pointerId) return;
            const bounds = stage.getBoundingClientRect();
            if (!bounds.width || !bounds.height) return;
            move(index, drag.start.x + (event.clientX - drag.x) / bounds.width,
                drag.start.y + (event.clientY - drag.y) / bounds.height);
        };
        handle.onlostpointercapture = () => { drag = null; };
        handle.onkeydown = event => {
            const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
            if (!delta) return;
            event.preventDefault();
            const step = event.shiftKey ? 0.05 : 0.01;
            move(index, corners[index].x + delta[0] * step, corners[index].y + delta[1] * step);
        };
    });

    for (const picker of pickers) {
        picker.onchange = async () => {
            const file = picker.files[0];
            if (!file) return;
            picker.value = '';
            const request = ++selection;
            scan.busy = true;
            scan.pending = false;
            area.hidden = true;
            status.textContent = 'Φορτώνεται η εικόνα…';
            try {
                const image = new Image();
                image.src = await photoData(file);
                await image.decode();
                if (request !== selection) return;
                source = image;
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                corners = [{x:0.05,y:0.05},{x:0.95,y:0.05},{x:0.95,y:0.95},{x:0.05,y:0.95}];
                scan.pending = true;
                area.hidden = false;
                status.textContent = '';
                draw();
            } catch {
                if (request === selection) status.textContent = 'Η εικόνα δεν άνοιξε. Δοκίμασε άλλη φωτογραφία.';
            } finally {
                if (request === selection) scan.busy = false;
            }
        };
    }

    create.onclick = () => {
        if (!source || scan.busy) return;
        try {
            const flattened = flattenReceipt(source, corners);
            scan.value = receiptPdf(flattened.toDataURL('image/jpeg', 0.76), flattened.width, flattened.height);
            scan.pending = false;
            area.hidden = true;
            clear.hidden = false;
            status.textContent = 'Το PDF είναι έτοιμο. Πάτησε Αποθήκευση για να μείνει στη σημείωση.';
        } catch {
            status.textContent = 'Έλεγξε ότι οι τέσσερις γωνίες είναι στη σωστή σειρά και δοκίμασε ξανά.';
        }
    };
    form.querySelector('#cancel-scan').onclick = () => {
        scan.pending = false;
        area.hidden = true;
        status.textContent = scan.value ? 'Το προηγούμενο PDF παραμένει στη σημείωση.' : '';
    };
    clear.onclick = () => {
        scan.value = '';
        clear.hidden = true;
        status.textContent = '';
    };
    clear.hidden = !scan.value;
    if (scan.value) status.textContent = 'Υπάρχει συνημμένο PDF σε αυτή τη σημείωση.';
    return scan;
}

function receiptProjection(points) {
    const [a, b, c, d] = points;
    const cross = (first, second, third) =>
        (second.x - first.x) * (third.y - second.y) - (second.y - first.y) * (third.x - second.x);
    if (points.some((point, i) => cross(point, points[(i + 1) % 4], points[(i + 2) % 4]) <= 0.0001)) {
        throw new Error('The crop corners must form a convex quadrilateral.');
    }
    // Map a unit rectangle to the photographed quadrilateral.
    const dx1 = b.x - c.x, dx2 = d.x - c.x, dx3 = a.x - b.x + c.x - d.x;
    const dy1 = b.y - c.y, dy2 = d.y - c.y, dy3 = a.y - b.y + c.y - d.y;
    const determinant = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / determinant;
    const h = (dx1 * dy3 - dx3 * dy1) / determinant;
    return (u, v) => {
        const scale = 1 + g * u + h * v;
        return {
            x: ((b.x - a.x + g * b.x) * u + (d.x - a.x + h * d.x) * v + a.x) / scale,
            y: ((b.y - a.y + g * b.y) * u + (d.y - a.y + h * d.y) * v + a.y) / scale
        };
    };
}

function flattenReceipt(image, corners) {
    const source = document.createElement('canvas');
    source.width = image.naturalWidth;
    source.height = image.naturalHeight;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const sourcePixels = context.getImageData(0, 0, source.width, source.height).data;
    const point = corners.map(p => ({ x: p.x * (source.width - 1), y: p.y * (source.height - 1) }));
    const project = receiptProjection(point);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const width = Math.max(distance(point[0], point[1]), distance(point[3], point[2]));
    const height = Math.max(distance(point[0], point[3]), distance(point[1], point[2]));
    if (width < 16 || height < 16) throw new Error('Receipt crop is too small.');
    const scale = Math.min(1, 1400 / Math.max(width, height));
    const output = document.createElement('canvas');
    output.width = Math.max(2, Math.round(width * scale));
    output.height = Math.max(2, Math.round(height * scale));
    const outputContext = output.getContext('2d');
    const outputPixels = outputContext.createImageData(output.width, output.height);
    for (let y = 0; y < output.height; y++) {
        for (let x = 0; x < output.width; x++) {
            const from = project(x / (output.width - 1), y / (output.height - 1));
            const col = Math.max(0, Math.min(source.width - 1, Math.round(from.x)));
            const row = Math.max(0, Math.min(source.height - 1, Math.round(from.y)));
            const origin = (row * source.width + col) * 4;
            const target = (y * output.width + x) * 4;
            for (let channel = 0; channel < 4; channel++) outputPixels.data[target + channel] = sourcePixels[origin + channel];
        }
    }
    outputContext.putImageData(outputPixels, 0, 0);
    return output;
}

function receiptPdf(jpegData, width, height) {
    const jpeg = atob(jpegData.split(',')[1]);
    const factor = 520 / Math.max(width, height);
    const w = Math.max(1, Math.round(width * factor)), h = Math.max(1, Math.round(height * factor));
    const drawing = 'q\n' + w + ' 0 0 ' + h + ' 0 0 cm\n/Receipt Do\nQ\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h +
            '] /Resources << /XObject << /Receipt 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /XObject /Subtype /Image /Width ' + width + ' /Height ' + height +
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n' + jpeg + '\nendstream',
        '<< /Length ' + drawing.length + ' >>\nstream\n' + drawing + 'endstream'
    ];
    let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = [];
    for (const [i, object] of objects.entries()) {
        offsets.push(pdf.length);
        pdf += (i + 1) + ' 0 obj\n' + object + '\nendobj\n';
    }
    const xref = pdf.length;
    pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' +
        offsets.map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') +
        'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return 'data:application/pdf;base64,' + btoa(pdf);
}

function downloadScanPdf(pdf) {
    if (!validScanPdf(pdf)) return;
    const bytes = Uint8Array.from(atob(pdf.split(',')[1]), character => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'apodeixi.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
