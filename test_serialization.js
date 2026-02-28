
const serializeNode = (node) => {
    if (node.type === 'text') {
        const commentMark = node.marks?.find(m => m.type === 'comment');
        if (commentMark) {
            return `<commented>${node.text}</commented><comment>${commentMark.attrs.comment}</comment>`;
        }
        return node.text;
    }

    if (node.type === 'paragraph') {
        return (node.content ? node.content.map(serializeNode).join('') : '') + '\n';
    }

    if (node.content) {
        return node.content.map(serializeNode).join('');
    }

    return '';
};

const testDoc = {
    type: 'doc',
    content: [
        {
            type: 'paragraph',
            content: [
                {
                    type: 'text',
                    text: 'Hello '
                },
                {
                    type: 'text',
                    marks: [
                        {
                            type: 'comment',
                            attrs: {
                                comment: 'This is a comment'
                            }
                        }
                    ],
                    text: 'world'
                },
                {
                    type: 'text',
                    text: '!'
                }
            ]
        }
    ]
};

const output = testDoc.content.map(serializeNode).join('');

const expected = 'Hello <commented>world</commented><comment>This is a comment</comment>!\n';

if (output === expected) {
    console.log('Test Passed!');
} else {
    console.error('Test Failed!');
    console.error(`Expected length: ${expected.length}`);
    console.error(`Actual length: ${output.length}`);
    console.error('Expected:', JSON.stringify(expected));
    console.error('Actual:', JSON.stringify(output));
    process.exit(1);
}
