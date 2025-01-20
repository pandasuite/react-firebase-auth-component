import React from 'react';

const StandaloneFormPage = (props) => {
  // eslint-disable-next-line react/prop-types
  const { children } = props;

  return (
    <div className="page">
      <div className="page-single">
        <div className="container">
          <div className="row">
            <div className="col mx-auto">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StandaloneFormPage;
